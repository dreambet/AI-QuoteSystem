
const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');

class QuoteGenerator {
  static generatePDF(quote, outputPath) {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument();
      const stream = fs.createWriteStream(outputPath);
      doc.pipe(stream);

      doc.fontSize(20).text('机加工报价单', { align: 'center' });
      doc.moveDown();

      doc.fontSize(14).text(`报价单号: ${quote.id}`);
      doc.text(`零件名称: ${quote.partName}`);
      doc.text(`零件编号: ${quote.partNumber || '-'}`);
      doc.text(`材料: ${quote.material}`);
      doc.moveDown();

      if (quote.calculation) {
        doc.fontSize(16).text('报价明细', { underline: true });
        doc.moveDown();
        doc.fontSize(12);
        doc.text(`材料成本: ¥${quote.calculation.materialCost.toFixed(2)}`);
        doc.text(`人工成本: ¥${quote.calculation.laborCost.toFixed(2)}`);
        doc.text(`设备费用: ¥${quote.calculation.equipmentCost.toFixed(2)}`);
        doc.text(`管理费用: ¥${quote.calculation.overheadCost.toFixed(2)}`);
        doc.text(`利润: ¥${quote.calculation.profit.toFixed(2)}`);
        doc.moveDown();
        doc.fontSize(16).text(`总计: ¥${quote.calculation.total.toFixed(2)}`, { align: 'right' });
      }

      if (quote.aiReview) {
        doc.moveDown();
        doc.fontSize(14).text('AI审核意见', { underline: true });
        doc.moveDown();
        doc.fontSize(12);
        doc.text(`状态: ${quote.aiReview.status === 'pass' ? '通过' : quote.aiReview.status === 'warning' ? '警告' : '不通过'}`);
        if (quote.aiReview.comments.length > 0) {
          doc.text('意见:');
          quote.aiReview.comments.forEach(comment => {
            doc.text(`  - ${comment}`);
          });
        }
      }

      if (quote.manualReview) {
        doc.moveDown();
        doc.fontSize(14).text('人工审核', { underline: true });
        doc.moveDown();
        doc.fontSize(12);
        doc.text(`状态: ${quote.manualReview.status === 'approved' ? '已通过' : quote.manualReview.status === 'rejected' ? '已拒绝' : '需修改'}`);
        doc.text(`审核意见: ${quote.manualReview.comments || '-'}`);
      }

      doc.moveDown(2);
      doc.fontSize(10).text(`生成时间: ${new Date().toLocaleString('zh-CN')}`, { align: 'center' });

      doc.end();
      stream.on('finish', () => resolve(outputPath));
      stream.on('error', reject);
    });
  }
}

module.exports = QuoteGenerator;

