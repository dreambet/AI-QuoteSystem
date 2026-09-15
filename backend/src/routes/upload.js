
const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const uploadsDir = path.join(__dirname, '../uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// 图纸仅支持 CAD 格式（DWG/DXF/STEP/STP），与 quotes.js 的 multer 规则保持一致
const DRAWING_EXTENSIONS = ['.dwg', '.dxf', '.step', '.stp'];
const fileFilter = (req, file, cb) => {
  const ext = path.extname(file.originalname).toLowerCase();
  if (!DRAWING_EXTENSIONS.includes(ext)) {
    return cb(new Error('不支持的图纸格式，仅支持 DWG/DXF/STEP/STP'));
  }
  cb(null, true);
};

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});

// 单文件 50MB 上限（CAD 图纸合理上限），防止无限制上传耗尽磁盘
const MAX_FILE_SIZE = Number(process.env.MAX_FILE_SIZE) || 50 * 1024 * 1024;
const upload = multer({ storage, fileFilter, limits: { fileSize: MAX_FILE_SIZE } });

router.post('/drawing', upload.single('drawing'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  res.json({
    filename: req.file.filename,
    originalName: req.file.originalname,
    path: req.file.path,
    size: req.file.size
  });
});

// multer fileFilter 抛错时返回 400 而非 500
router.use((err, req, res, next) => {
  res.status(400).json({ error: err.message || '上传失败' });
});

module.exports = router;

