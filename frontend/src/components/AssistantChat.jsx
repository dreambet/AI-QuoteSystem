import React, { useEffect, useMemo, useRef, useState } from 'react';

const STORAGE_PREFIX = 'machining-console-assistant';
const USER_KEY = `${STORAGE_PREFIX}:user`;
const CONVERSATION_KEY = `${STORAGE_PREFIX}:conversation`;
const MESSAGES_KEY = `${STORAGE_PREFIX}:messages`;
const WELCOME_MESSAGE = {
  id: 'welcome',
  role: 'assistant',
  content: 
`👋 您好，我是 Carve 机加工 AI 智能报价助手！
💡 我可提供这些服务：
✅ 手动报价完整操作讲解
✅ 图纸 AI 识图报价全流程指引
✅ 报价各项计算规则说明
✅ 系统报错、功能异常排查
📌 应答规则：全部内容严格参考内部知识库。如果知识库无相关内容，我会直接说明，不会私自猜测价格、功能与系统状态。
⚠️ 重要提醒：AI 给出的报价仅作为辅助参考，最终报价必须人工复核确认。`
};

function createId(prefix) {
  const suffix = typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}-${suffix}`;
}

function loadMessages() {
  try {
    const parsed = JSON.parse(localStorage.getItem(MESSAGES_KEY) || '[]');
    return Array.isArray(parsed) ? parsed.filter(item => item?.content && item?.role) : [];
  } catch (_) {
    return [];
  }
}

function readSseEvents(raw) {
  return raw.split(/\r?\n\r?\n/).map(block => {
    const event = block.split(/\r?\n/).find(line => line.startsWith('event:'))?.slice(6).trim() || 'message';
    const dataText = block.split(/\r?\n/)
      .filter(line => line.startsWith('data:'))
      .map(line => line.slice(5).trim())
      .join('\n');
    if (!dataText) return null;
    try {
      return { event, data: JSON.parse(dataText) };
    } catch (_) {
      return null;
    }
  }).filter(Boolean);
}

export default function AssistantChat() {
  const [isOpen, setIsOpen] = useState(false);
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState(() => loadMessages());
  const [conversationId, setConversationId] = useState(() => localStorage.getItem(CONVERSATION_KEY) || '');
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState('');
  const [lastQuery, setLastQuery] = useState('');
  const endRef = useRef(null);
  const controllerRef = useRef(null);
  const userId = useMemo(() => {
    let saved = localStorage.getItem(USER_KEY);
    if (!saved) {
      saved = createId('browser');
      localStorage.setItem(USER_KEY, saved);
    }
    return saved;
  }, []);

  useEffect(() => {
    localStorage.setItem(MESSAGES_KEY, JSON.stringify(messages.slice(-80)));
  }, [messages]);

  useEffect(() => {
    if (conversationId) localStorage.setItem(CONVERSATION_KEY, conversationId);
    else localStorage.removeItem(CONVERSATION_KEY);
  }, [conversationId]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, isStreaming, error, isOpen]);

  useEffect(() => () => controllerRef.current?.abort(), []);

  const updateAssistantMessage = (messageId, updater) => {
    setMessages(current => current.map(message => (
      message.id === messageId ? { ...message, content: updater(message.content) } : message
    )));
  };

  const sendMessage = async (rawQuery, appendUser = true) => {
    const query = rawQuery.trim();
    if (!query || isStreaming) return;

    setError('');
    setLastQuery(query);
    setInput('');
    setIsStreaming(true);
    const assistantId = createId('assistant');
    setMessages(current => [
      ...current,
      ...(appendUser ? [{ id: createId('user'), role: 'user', content: query }] : []),
      { id: assistantId, role: 'assistant', content: '', streaming: true }
    ]);

    const controller = new AbortController();
    controllerRef.current = controller;
    let receivedContent = false;

    try {
      const response = await fetch('/api/assistant/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, conversationId: conversationId || undefined, userId }),
        signal: controller.signal
      });

      if (!response.ok || !response.body) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error || '智能助手暂时不可用，请稍后重试。');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buffer = '';
      let streamFinished = false;

      while (!streamFinished) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const boundary = buffer.lastIndexOf('\n\n');
        if (boundary < 0) continue;
        const chunk = buffer.slice(0, boundary + 2);
        buffer = buffer.slice(boundary + 2);

        readSseEvents(chunk).forEach(({ event, data }) => {
          if (data.conversationId) setConversationId(data.conversationId);
          if (event === 'message' && data.answer) {
            receivedContent = true;
            updateAssistantMessage(assistantId, current => current + data.answer);
          }
          if (event === 'error') throw new Error(data.message || '智能助手返回了错误。');
          if (event === 'complete') streamFinished = true;
        });
      }

      if (!receivedContent) {
        updateAssistantMessage(assistantId, () => '本次未收到有效回复，请重试。');
      }
    } catch (requestError) {
      controller.abort();
      const cancelled = requestError.name === 'AbortError';
      if (cancelled) {
        updateAssistantMessage(assistantId, current => current || '已停止生成。');
      } else {
        setError(requestError.message || '智能助手暂时不可用，请稍后重试。');
        updateAssistantMessage(assistantId, current => current || '抱歉，本次对话未能完成。');
      }
    } finally {
      controllerRef.current = null;
      setMessages(current => current.map(message => (
        message.id === assistantId ? { ...message, streaming: false } : message
      )));
      setIsStreaming(false);
    }
  };

  const startNewConversation = () => {
    controllerRef.current?.abort();
    setConversationId('');
    setMessages([]);
    setError('');
    setLastQuery('');
  };

  const cancelStreaming = () => controllerRef.current?.abort();

  const displayedMessages = messages.length ? messages : [WELCOME_MESSAGE];

  return (
    <section className={`assistant-chat ${isOpen ? 'is-open' : ''}`} aria-label="机加工智能助手">
      {isOpen && (
        <div className="assistant-chat-panel" role="dialog" aria-modal="false" aria-label="智能问答">
          <header className="assistant-chat-header">
            <div className="assistant-identity"><span className="assistant-avatar">AI</span><span><strong>机加工智能助手</strong><small><i /> 在线 · Dify 智能问答</small></span></div>
            <div className="assistant-header-actions">
              <button type="button" onClick={startNewConversation} title="新建会话" disabled={isStreaming}>↻</button>
              <button type="button" onClick={() => setIsOpen(false)} title="关闭助手">×</button>
            </div>
          </header>

          <div className="assistant-chat-history" aria-live="polite">
            {displayedMessages.map(message => (
              <article className={`assistant-message ${message.role}`} key={message.id}>
                <span className="assistant-message-role">{message.role === 'user' ? '您' : 'AI'}</span>
                <p>{message.content || (message.streaming ? <span className="assistant-typing">正在思考</span> : '')}</p>
              </article>
            ))}
            {error && <div className="assistant-error"><span>{error}</span><button type="button" onClick={() => sendMessage(lastQuery, false)} disabled={!lastQuery || isStreaming}>重新尝试</button></div>}
            <div ref={endRef} />
          </div>

          <form className="assistant-input-area" onSubmit={event => { event.preventDefault(); sendMessage(input); }}>
            <textarea value={input} onChange={event => setInput(event.target.value)} placeholder="请输入系统相关操作问题…" rows="2" disabled={isStreaming} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); sendMessage(input); } }} />
            <div className="assistant-input-actions">
              <small>Enter 发送 · Shift + Enter 换行</small>
              {isStreaming ? <button type="button" className="assistant-stop" onClick={cancelStreaming}>停止</button> : <button type="submit" className="assistant-send" disabled={!input.trim()}>发送 ↗</button>}
            </div>
          </form>
        </div>
      )}

      <button type="button" className="assistant-bubble" onClick={() => setIsOpen(open => !open)} aria-expanded={isOpen} aria-label={isOpen ? '关闭智能助手' : '打开智能助手'}>
        <span className="assistant-bubble-orbit" />
        <span className="assistant-bubble-icon">✦</span>
        <span className="assistant-online-dot" />
        {!isOpen && <span className="assistant-bubble-label">智能问答</span>}
      </button>
    </section>
  );
}
