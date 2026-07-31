const express = require('express');
const axios = require('axios');

const router = express.Router();
const REQUEST_TIMEOUT_MS = 120000;

function sendEvent(res, event, payload) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function normaliseUserId(value) {
  const userId = String(value || '').trim();
  if (!/^[a-zA-Z0-9_-]{8,128}$/.test(userId)) {
    return null;
  }
  return userId;
}

function normaliseConversationId(value) {
  const conversationId = String(value || '').trim();
  return conversationId && conversationId.length <= 128 ? conversationId : undefined;
}

function parseSseBlock(block) {
  const data = block
    .split(/\r?\n/)
    .filter(line => line.startsWith('data:'))
    .map(line => line.slice(5).trim())
    .join('\n');

  if (!data || data === '[DONE]') return null;
  try {
    return JSON.parse(data);
  } catch (_) {
    return null;
  }
}

router.post('/chat', async (req, res) => {
  const query = typeof req.body?.query === 'string' ? req.body.query.trim() : '';
  const user = normaliseUserId(req.body?.userId);
  const conversationId = normaliseConversationId(req.body?.conversationId);

  if (!query) return res.status(400).json({ error: '请输入需要咨询的问题。' });
  if (query.length > 4000) return res.status(400).json({ error: '单次问题不能超过 4000 个字符。' });
  if (!user) return res.status(400).json({ error: '会话身份无效，请新建会话后重试。' });

  const baseUrl = String(process.env.DIFY_API_BASE || '').replace(/\/+$/, '');
  const apiKey = process.env.DIFY_API_KEY;
  if (!baseUrl || !apiKey) {
    return res.status(503).json({ error: '智能助手尚未完成服务端配置，请联系管理员。' });
  }

  let upstream;
  try {
    upstream = await axios.post(
      `${baseUrl}/chat-messages`,
      {
        inputs: {},
        query,
        response_mode: 'streaming',
        user,
        ...(conversationId ? { conversation_id: conversationId } : {})
      },
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          Accept: 'text/event-stream',
          'Content-Type': 'application/json'
        },
        responseType: 'stream',
        timeout: REQUEST_TIMEOUT_MS,
        validateStatus: () => true
      }
    );
  } catch (error) {
    const message = error.code === 'ECONNABORTED'
      ? '智能助手响应超时，请稍后重试。'
      : '暂时无法连接智能助手服务，请稍后重试。';
    return res.status(502).json({ error: message });
  }

  if (upstream.status < 200 || upstream.status >= 300) {
    let detail = '';
    upstream.data.on('data', chunk => { detail += chunk.toString(); });
    upstream.data.on('end', () => {
      try {
        const parsed = JSON.parse(detail);
        return res.status(502).json({ error: parsed.message || '智能助手服务暂时不可用。' });
      } catch (_) {
        return res.status(502).json({ error: '智能助手服务暂时不可用。' });
      }
    });
    upstream.data.on('error', () => res.status(502).json({ error: '智能助手服务暂时不可用。' }));
    return undefined;
  }

  res.status(200);
  res.set({
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no'
  });
  res.flushHeaders();

  let buffer = '';
  let completed = false;
  const heartbeat = setInterval(() => res.write(': keep-alive\n\n'), 15000);
  const finish = () => {
    clearInterval(heartbeat);
    if (!completed) {
      completed = true;
      sendEvent(res, 'complete', {});
    }
    res.end();
  };

  const handleBlock = block => {
    const data = parseSseBlock(block);
    if (!data) return;

    const payload = {
      answer: typeof data.answer === 'string' ? data.answer : '',
      conversationId: data.conversation_id || undefined
    };

    if (data.event === 'message' && payload.answer) {
      sendEvent(res, 'message', payload);
    } else if (data.event === 'message_end') {
      completed = true;
      sendEvent(res, 'complete', payload);
    } else if (data.event === 'error') {
      completed = true;
      sendEvent(res, 'error', { message: data.message || '智能助手返回了错误。' });
    }
  };

  upstream.data.on('data', chunk => {
    buffer += chunk.toString('utf8');
    const blocks = buffer.split(/\r?\n\r?\n/);
    buffer = blocks.pop();
    blocks.forEach(handleBlock);
  });
  upstream.data.on('end', () => {
    if (buffer.trim()) handleBlock(buffer);
    finish();
  });
  upstream.data.on('error', () => {
    if (!completed) sendEvent(res, 'error', { message: '智能助手连接中断，请重试。' });
    finish();
  });
  // The response close event reflects a user closing the chat panel or
  // navigating away. Listening on req.close can fire once request-body
  // parsing completes and would prematurely stop a healthy stream.
  res.on('close', () => {
    clearInterval(heartbeat);
    if (!res.writableEnded) upstream.data.destroy();
  });
});

module.exports = router;
