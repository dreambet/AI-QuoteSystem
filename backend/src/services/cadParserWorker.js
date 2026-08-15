// CAD 解析 worker：occt-import-js(WASM) 的 STEP 网格化是 CPU 密集且同步阻塞的，
// 放到 worker 线程执行，避免解析期间阻塞 Express 事件循环（其它请求如报价列表仍可响应）。
const { parentPort } = require('worker_threads');
const CADParserService = require('./CADParserService');

// 解析结果可达数 MB（含数十万个 Number 的嵌套数组），结构化克隆很慢；
// 改传 JSON 字符串（拷贝为 memcpy），主线程再 parse，整体快一个数量级。
const send = payload => parentPort.postMessage({ ...payload, result: payload.result !== undefined ? JSON.stringify(payload.result) : undefined });

parentPort.on('message', async ({ jobId, kind, filePath }) => {
  try {
    if (kind === 'warmup') {
      // 服务启动时预加载 occt WASM，避免首次真实解析叠加初始化耗时
      await CADParserService._getOCCT();
      send({ jobId, ok: true, result: { warmed: true } });
      return;
    }
    const result = await CADParserService[kind](filePath);
    send({ jobId, ok: true, result });
  } catch (error) {
    send({ jobId, ok: false, error: (error && error.message) || String(error) });
  }
});
