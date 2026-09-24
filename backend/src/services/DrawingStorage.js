const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const db = require('../db');

const DRAWING_EXTENSIONS = new Set(['.dwg', '.dxf', '.step', '.stp']);
const ARCHIVABLE_DRAWING_EXTENSIONS = new Set([...DRAWING_EXTENSIONS, '.pdf']);
const configuredDir = process.env.UPLOAD_DIR || 'uploads';
// 相对路径以 backend/src 为基准，兼容存量 backend/src/uploads 图纸目录。
const uploadsDir = path.isAbsolute(configuredDir) ? configuredDir : path.resolve(__dirname, '..', configuredDir);
const modelsDir = path.join(uploadsDir, 'models');
const maxFileSize = Math.max(1024 * 1024, Number(process.env.MAX_FILE_SIZE) || 50 * 1024 * 1024);
const retentionDays = Math.max(1, Number(process.env.UPLOAD_RETENTION_DAYS) || 90);

function ensureDirectories() {
  fs.mkdirSync(uploadsDir, { recursive: true });
  fs.mkdirSync(modelsDir, { recursive: true });
}

function extensionOf(name) {
  return path.extname(String(name || '')).toLowerCase();
}

function validateExtension(name) {
  const ext = extensionOf(name);
  if (!DRAWING_EXTENSIONS.has(ext)) throw new Error('不支持的图纸格式，仅支持 DWG、DXF、STEP、STP。');
  return ext;
}

function createStorageName(originalName) {
  return `${crypto.randomUUID()}${validateExtension(originalName)}`;
}

function resolveStoredFile(fileId, allowedExtensions) {
  const safeName = path.basename(String(fileId || ''));
  const extension = extensionOf(safeName);
  // 允许既有时间戳命名图纸继续使用；新上传始终使用 UUID。两者都禁止目录、空格及特殊字符。
  if (safeName !== fileId || !/^[a-zA-Z0-9_-]+\.[a-zA-Z0-9]+$/i.test(safeName) || !allowedExtensions.has(extension)) {
    throw new Error('图纸标识无效。');
  }
  const target = path.resolve(uploadsDir, safeName);
  if (path.dirname(target) !== uploadsDir) throw new Error('图纸路径无效。');
  return target;
}

function resolveDrawing(fileId) {
  return resolveStoredFile(fileId, DRAWING_EXTENSIONS);
}

function resolveArchivableDrawing(fileId) {
  return resolveStoredFile(fileId, ARCHIVABLE_DRAWING_EXTENSIONS);
}

async function validateFileSignature(filePath, fileName) {
  const ext = validateExtension(fileName);
  const handle = await fs.promises.open(filePath, 'r');
  try {
    const buffer = Buffer.alloc(512);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    const head = buffer.subarray(0, bytesRead);
    const text = head.toString('utf8').replace(/^\uFEFF/, '').trimStart().toUpperCase();
    const valid = ext === '.dwg'
      ? /^AC1\d{3}/.test(head.toString('ascii', 0, 6))
      : ext === '.dxf'
        ? /(?:^|\n)\s*0\s*(?:\r?\n)\s*SECTION\b/.test(text)
        : text.startsWith('ISO-10303-21');
    if (!valid) throw new Error('文件内容与所选 CAD 格式不匹配，请确认文件未损坏且格式正确。');
  } finally {
    await handle.close();
  }
}

function multerStorage() {
  ensureDirectories();
  return {
    destination: (req, file, cb) => cb(null, uploadsDir),
    filename: (req, file, cb) => {
      try { cb(null, createStorageName(file.originalname)); } catch (error) { cb(error); }
    }
  };
}

function multerFilter(req, file, cb) {
  try { validateExtension(file.originalname); cb(null, true); } catch (error) { cb(error); }
}

async function removeFileIfExists(filePath) {
  if (!filePath) return;
  await fs.promises.unlink(filePath).catch(() => {});
}

async function clearCompletedQuoteDrawing(quote) {
  if (!quote?.id) return { sourceRemoved: false, modelRemoved: false };
  let sourceRemoved = false;
  let modelRemoved = false;

  // 同一文件若仍被未完成任务引用，不能删除；新上传文件采用随机名称，通常不会触发该分支。
  if (quote.drawingPath) {
    const shared = await db.query('SELECT id FROM quotes WHERE drawingPath = ? AND id <> ? LIMIT 1', [quote.drawingPath, quote.id]);
    if (!shared.length) {
      try {
        // PDF 仅兼容历史报价归档；新上传与重新解析仍只允许 CAD 格式。
        const sourcePath = resolveArchivableDrawing(quote.drawingPath);
        await removeFileIfExists(sourcePath);
        sourceRemoved = true;
      } catch (error) {
        console.warn(`已完成报价 ${quote.id} 的原始图纸未清理:`, error.message);
      }
    }
  }

  // 三维缓存也属于由原始图纸生成的数据，已完成报价只保留结构化识别结果。
  if (/^[a-zA-Z0-9_-]+$/.test(String(quote.id))) {
    const modelPath = path.join(modelsDir, `${quote.id}.json`);
    const existed = await fs.promises.stat(modelPath).then(() => true).catch(() => false);
    await removeFileIfExists(modelPath);
    modelRemoved = existed;
  }
  return { sourceRemoved, modelRemoved };
}

async function cleanupCompletedQuoteDrawings() {
  const completed = await db.query("SELECT id, drawingPath FROM quotes WHERE status = 'finalized' AND drawingPath IS NOT NULL");
  for (const quote of completed) {
    const archivedAt = new Date();
    // 先从业务记录解除原图关联，历史页面继续从已保存的识别结果和报价快照读取数据。
    await db.query('UPDATE quotes SET drawingPath = NULL, drawingArchivedAt = COALESCE(drawingArchivedAt, ?), updatedAt = ? WHERE id = ?', [archivedAt, archivedAt, quote.id]);
    await clearCompletedQuoteDrawing(quote);
  }
  if (completed.length) console.info(`已按完成状态清理 ${completed.length} 个报价任务的图纸关联。`);
}

async function cleanupUnreferencedFiles() {
  ensureDirectories();
  const cutoff = Date.now() - retentionDays * 86400000;
  const referencedRows = await db.query('SELECT drawingPath FROM quotes WHERE drawingPath IS NOT NULL');
  const referenced = new Set(referencedRows.map(row => row.drawingPath).filter(Boolean));
  const entries = await fs.promises.readdir(uploadsDir, { withFileTypes: true });
  let deleted = 0;
  for (const entry of entries) {
    if (!entry.isFile() || !ARCHIVABLE_DRAWING_EXTENSIONS.has(extensionOf(entry.name)) || referenced.has(entry.name)) continue;
    const filePath = path.join(uploadsDir, entry.name);
    const stat = await fs.promises.stat(filePath).catch(() => null);
    if (stat && stat.mtimeMs < cutoff) {
      await fs.promises.unlink(filePath).catch(() => {});
      deleted += 1;
    }
  }
  if (deleted) console.info(`已清理 ${deleted} 个过期且未关联的图纸文件。`);
}

function scheduleUploadCleanup() {
  cleanupUnreferencedFiles().catch(error => console.error('图纸清理失败:', error.message));
  cleanupCompletedQuoteDrawings().catch(error => console.error('已完成报价图纸清理失败:', error.message));
  const timer = setInterval(() => {
    cleanupUnreferencedFiles().catch(error => console.error('图纸清理失败:', error.message));
    cleanupCompletedQuoteDrawings().catch(error => console.error('已完成报价图纸清理失败:', error.message));
  }, 24 * 60 * 60 * 1000);
  timer.unref();
}

module.exports = {
  uploadsDir, modelsDir, maxFileSize, ensureDirectories, multerStorage, multerFilter,
  validateFileSignature, resolveDrawing, removeFileIfExists, clearCompletedQuoteDrawing, cleanupCompletedQuoteDrawings, scheduleUploadCleanup
};
