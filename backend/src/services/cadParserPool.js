// CAD 解析池：单 worker 串行执行解析任务 + 同文件结果缓存。
// - 单 worker：occt/dwgdxf 的 WASM 实例较重且解析本身 CPU 密集，串行化可预期且内存可控
// - 结果缓存：以 文件路径+大小+mtime 为键，重复分析同一张图纸直接命中，无需再次网格化
// - 预热：服务启动时即拉起 worker 并加载 occt WASM，首次真实解析无需再付初始化成本
const { Worker } = require('worker_threads');
const path = require('path');
const fs = require('fs');

const CACHE_LIMIT = 6; // 每个解析结果含网格可达数 MB，限制缓存条数

class CadParserPool {
  constructor() {
    this.worker = null;
    this.jobs = new Map();
    this.seq = 0;
    this.cache = new Map(); // key -> parseResult（LRU）
  }

  _ensureWorker() {
    if (this.worker) return this.worker;
    this.worker = new Worker(path.join(__dirname, 'cadParserWorker.js'));
    this.worker.on('message', ({ jobId, ok, result, error }) => {
      const job = this.jobs.get(jobId);
      if (!job) return;
      this.jobs.delete(jobId);
      if (ok) job.resolve(result !== undefined ? JSON.parse(result) : undefined);
      else job.reject(new Error(error));
    });
    // worker 崩溃：拒绝所有挂起任务，下次调用时重建 worker
    this.worker.on('error', err => {
      for (const job of this.jobs.values()) job.reject(err);
      this.jobs.clear();
      this.worker = null;
    });
    this.worker.unref(); // 仅承担解析，不阻止主进程退出
    return this.worker;
  }

  _run(kind, filePath) {
    const worker = this._ensureWorker();
    const jobId = ++this.seq;
    return new Promise((resolve, reject) => {
      this.jobs.set(jobId, { resolve, reject });
      worker.postMessage({ jobId, kind, filePath });
    });
  }

  // 服务启动时调用：拉起 worker 并预载 occt WASM（失败不影响后续按需拉起）
  warmup() {
    try { return this._run('warmup', ''); } catch { return Promise.resolve(); }
  }

  // 带缓存的解析：返回 { result, cached }
  async _runCached(kind, filePath) {
    let key = null;
    try {
      const stat = fs.statSync(filePath);
      key = `${kind}:${filePath}:${stat.size}:${stat.mtimeMs}`;
    } catch { /* 文件异常时走正常解析报错路径 */ }
    if (key && this.cache.has(key)) {
      const hit = this.cache.get(key);
      this.cache.delete(key); // LRU：命中后移到最新
      this.cache.set(key, hit);
      return { result: hit, cached: true };
    }
    const result = await this._run(kind, filePath);
    if (key && result && result.success) {
      this.cache.set(key, result);
      while (this.cache.size > CACHE_LIMIT) this.cache.delete(this.cache.keys().next().value);
    }
    return { result, cached: false };
  }

  parseDXF(filePath) { return this._runCached('parseDXF', filePath); }
  parseDWG(filePath) { return this._runCached('parseDWG', filePath); }
  parseSTEP(filePath) { return this._runCached('parseSTEP', filePath); }
}

module.exports = new CadParserPool();
