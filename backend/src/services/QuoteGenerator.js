const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');

/**
 * Generates a Chinese machining quote PDF.
 *
 * PDFKit only ships with Latin standard fonts.  Always embed a CJK TrueType
 * font, otherwise Chinese text is written as missing/garbled glyphs in the
 * exported file.
 */
class QuoteGenerator {
  static resolveChineseFont() {
    const candidates = [
      process.env.PDF_CJK_FONT_PATH,
      path.join(__dirname, '../../assets/fonts/NotoSansSC-Regular.ttf'),
      'C:\\Windows\\Fonts\\Deng.ttf',
      'C:\\Windows\\Fonts\\simhei.ttf',
      '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc',
      '/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc'
    ].filter(Boolean);

    const fontPath = candidates.find(candidate => fs.existsSync(candidate));
    if (!fontPath) {
      throw new Error('无法生成中文报价单：未找到可用中文字体。请设置 PDF_CJK_FONT_PATH。');
    }
    return fontPath;
  }

  static amount(value) {
    return `¥${Number(value || 0).toFixed(2)}`;
  }

  static value(value, fallback = '-') {
    return value === undefined || value === null || value === '' ? fallback : String(value);
  }

  static addSectionTitle(doc, title) {
    doc.moveDown(0.6);
    doc.fillColor('#117A8B').fontSize(13).text(title);
    doc.moveDown(0.25);
    doc.moveTo(doc.page.margins.left, doc.y)
      .lineTo(doc.page.width - doc.page.margins.right, doc.y)
      .strokeColor('#B7D9DE')
      .lineWidth(0.8)
      .stroke();
    doc.moveDown(0.45).fillColor('#213544').fontSize(10.5);
  }

  static addKeyValue(doc, label, value) {
    doc.fillColor('#66808D').text(label, { continued: true });
    doc.fillColor('#213544').text(` ${this.value(value)}`);
  }

  static addFooter(doc) {
    const range = doc.bufferedPageRange();
    for (let index = 0; index < range.count; index += 1) {
      doc.switchToPage(index);
      doc.fontSize(8.5).fillColor('#77909B')
        .text(
          `机加工智能报价系统  ·  报价单生成时间：${new Date().toLocaleString('zh-CN')}  ·  第 ${index + 1} / ${range.count} 页`,
          doc.page.margins.left,
          // Keep the footer above PDFKit's bottom margin; writing below it
          // would silently create a new, footer-only page.
          doc.page.height - doc.page.margins.bottom - 13,
          { width: doc.page.width - doc.page.margins.left - doc.page.margins.right, align: 'center', lineBreak: false }
        );
    }
  }

  static generatePDF(quote, outputPath) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (callback, value) => {
        if (!settled) {
          settled = true;
          callback(value);
        }
      };

      try {
        const doc = new PDFDocument({
          size: 'A4',
          margin: 46,
          bufferPages: true,
          info: {
            Title: `报价单-${this.value(quote.partName, '未命名零件')}`,
            Author: '机加工智能报价系统',
            Subject: '机加工报价单'
          }
        });
        const stream = fs.createWriteStream(outputPath);
        const fontPath = this.resolveChineseFont();

        doc.pipe(stream);
        doc.registerFont('CJK', fontPath);
        doc.font('CJK');

        stream.on('finish', () => finish(resolve, outputPath));
        stream.on('error', error => finish(reject, error));
        doc.on('error', error => finish(reject, error));

        // Header
        doc.rect(0, 0, doc.page.width, 96).fill('#092D3D');
        doc.fillColor('#55D5E7').fontSize(9).text('MACHINING QUOTE  /  工业制造报价', 46, 24);
        doc.fillColor('#FFFFFF').fontSize(23).text('机加工报价单', 46, 43);
        doc.fillColor('#C4EAF0').fontSize(9).text(`报价单号：#${this.value(quote.id)}`, 46, 73);
        doc.y = 112;

        this.addSectionTitle(doc, '基本信息');
        this.addKeyValue(doc, '零件名称：', quote.partName);
        this.addKeyValue(doc, '物料编码：', quote.materialCode);
        this.addKeyValue(doc, '材料：', quote.material);
        this.addKeyValue(doc, '数量：', quote.quantity);
        this.addKeyValue(doc, '毛重(kg)：', quote.grossWeight);
        this.addKeyValue(doc, '净重(kg)：', quote.netWeight);

        // 材料规格 / 产品规格
        const blankSpec = quote.blankSpec || {};
        const finishedSpec = quote.finishedSpec || {};
        const blankEntries = Object.entries(blankSpec || {});
        const finishedEntries = Object.entries(finishedSpec || {});
        if (blankEntries.length || finishedEntries.length) {
          this.addSectionTitle(doc, '规格参数');
          if (blankEntries.length) {
            doc.fillColor('#117A8B').fontSize(11).text('材料规格');
            doc.fillColor('#213544').fontSize(10.5);
            this.addKeyValue(doc, '材料规格：', blankEntries.map(([k, v]) => `${k}=${v}`).join('，'));
          }
          if (finishedEntries.length) {
            doc.moveDown(0.3).fillColor('#117A8B').fontSize(11).text('产品规格');
            doc.fillColor('#213544').fontSize(10.5);
            this.addKeyValue(doc, '产品规格：', finishedEntries.map(([k, v]) => `${k}=${v}`).join('，'));
          }
        }

        const calculation = quote.calculation;
        if (calculation) {
          const priceSnap = quote.priceSnapshot || {};

          this.addSectionTitle(doc, '报价计算明细');
          doc.fillColor('#117A8B').fontSize(11).text('01  材料成本');
          doc.fillColor('#213544').fontSize(10.5);
          this.addKeyValue(doc, '毛重 × 单价：', `${Number(quote.grossWeight || calculation.inputs?.grossWeight || 0)} × ${this.value(priceSnap.unitPrice)} = ${this.amount(calculation.materialCost)}`);

          doc.moveDown(0.45).fillColor('#117A8B').fontSize(11).text('02  机加工工序');
          doc.fillColor('#213544').fontSize(10.5);
          const processes = Array.isArray(calculation.processes) ? calculation.processes : [];
          if (processes.length) {
            processes.forEach((p, i) => {
              doc.text(`${i + 1}. ${this.value(p.name)}  ·  工费率 ${this.value(p.hourlyRate)}元/h  ·  ${this.value(p.minutes)} 分钟  ·  成本 ${this.amount(p.cost)}`);
            });
            this.addKeyValue(doc, '机加工成本 R：', this.amount(calculation.machiningCost));
          } else {
            doc.fillColor('#77909B').text('无机加工工序。');
          }

          doc.moveDown(0.45).fillColor('#117A8B').fontSize(11).text('03  附加费用');
          doc.fillColor('#213544').fontSize(10.5);
          const additions = Array.isArray(calculation.additions) ? calculation.additions : [];
          if (additions.length) {
            additions.forEach((a, i) => {
              doc.text(`${i + 1}. ${this.value(a.name)}  ·  ${this.value(a.formula)}  ·  成本 ${this.amount(a.cost)}`);
            });
          } else {
            doc.fillColor('#77909B').text('无附加费用。');
          }

          doc.moveDown(0.45).fillColor('#117A8B').fontSize(11).text('04  费用链');
          doc.fillColor('#213544').fontSize(10.5);
          const trace = calculation.formulaTrace || {};
          ['K', 'R', 'S', 'T', 'U', 'V', 'W'].forEach(key => {
            const t = trace[key];
            if (t) this.addKeyValue(doc, `${t.label}：`, t.expression);
          });

          this.addSectionTitle(doc, '费用汇总');
          const costRows = [
            ['材料成本 K', calculation.materialCost],
            ['机加工成本 R', calculation.machiningCost],
            ['管销 S', calculation.overhead],
            ['小计 T', calculation.subtotal],
            ['利润 U', calculation.profit],
            ['含税成本 V', calculation.taxIncluded],
            ['样品价格 W', calculation.samplePrice],
            ['打样调机费', calculation.setupFee]
          ];
          costRows.forEach(([label, cost]) => this.addKeyValue(doc, `${label}：`, this.amount(cost)));
          doc.moveDown(0.35);
          const totalBoxY = doc.y;
          const totalBoxWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
          doc.roundedRect(doc.page.margins.left, totalBoxY, totalBoxWidth, 38, 6).fill('#E4F7F8');
          doc.fillColor('#0B5968').fontSize(12)
            .text('报价总额', doc.page.margins.left + 13, totalBoxY + 12, { lineBreak: false });
          doc.fillColor('#0A3846').fontSize(17)
            .text(this.amount(calculation.total), doc.page.margins.left, totalBoxY + 8, { width: totalBoxWidth - 13, align: 'right', lineBreak: false });
          doc.y = totalBoxY + 52;

          if (priceSnap.unitPrice != null) {
            this.addKeyValue(doc, '单价快照：', `${this.value(priceSnap.unitPrice)} 元/kg（来源 ${this.value(priceSnap.source)}，${priceSnap.confirmedAt ? new Date(priceSnap.confirmedAt).toLocaleString('zh-CN') : '未确认'}）`);
          }
        }

        if (quote.aiReview) {
          doc.addPage();
          doc.font('CJK');
          this.addSectionTitle(doc, 'AI 审核意见');
          this.addKeyValue(doc, '审核状态：', quote.aiReview.status);
          const comments = Array.isArray(quote.aiReview.comments) ? quote.aiReview.comments : [];
          const suggestions = Array.isArray(quote.aiReview.suggestions) ? quote.aiReview.suggestions : [];
          if (comments.length) {
            doc.fillColor('#117A8B').fontSize(11).text('审核意见');
            doc.fillColor('#213544').fontSize(10.5);
            comments.forEach((comment, index) => doc.text(`${index + 1}. ${this.value(comment)}`));
          }
          if (suggestions.length) {
            doc.moveDown(0.45).fillColor('#117A8B').fontSize(11).text('优化建议');
            doc.fillColor('#213544').fontSize(10.5);
            suggestions.forEach((suggestion, index) => doc.text(`${index + 1}. ${this.value(suggestion)}`));
          }
        }

        if (quote.manualReview) {
          this.addSectionTitle(doc, '人工审核');
          this.addKeyValue(doc, '审核状态：', quote.manualReview.status);
          this.addKeyValue(doc, '审核意见：', quote.manualReview.comments);
          this.addKeyValue(doc, '审核时间：', quote.manualReview.reviewedAt ? new Date(quote.manualReview.reviewedAt).toLocaleString('zh-CN') : '-');
        }

        this.addFooter(doc);
        doc.end();
      } catch (error) {
        finish(reject, error);
      }
    });
  }
}

module.exports = QuoteGenerator;
