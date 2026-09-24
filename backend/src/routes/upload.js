
const express = require('express');
const router = express.Router();
const multer = require('multer');
const DrawingStorage = require('../services/DrawingStorage');

const upload = multer({
  storage: multer.diskStorage(DrawingStorage.multerStorage()),
  fileFilter: DrawingStorage.multerFilter,
  limits: { fileSize: DrawingStorage.maxFileSize }
});

router.post('/drawing', upload.single('drawing'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }
  try {
    await DrawingStorage.validateFileSignature(req.file.path, req.file.filename);
    // 仅返回不可猜测的文件标识，绝不暴露服务器物理路径或原始文件名。
    res.status(201).json({ fileId: req.file.filename, size: req.file.size });
  } catch (error) {
    await DrawingStorage.removeFileIfExists(req.file.path);
    res.status(400).json({ error: error.message });
  }
});

// multer fileFilter 抛错时返回 400 而非 500
router.use((err, req, res, next) => {
  res.status(400).json({ error: err.message || '上传失败' });
});

module.exports = router;
