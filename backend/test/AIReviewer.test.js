const test = require('node:test');
const assert = require('node:assert/strict');
const AIReviewer = require('../src/services/AIReviewer');

const baseQuote = {
  calculation: { total: 1200, subtotal: 1000, materialCost: 300, machiningCost: 300 },
  material: '铝合金',
  quantity: 1,
  priceSnapshot: { source: 'manual', unitPrice: 20, stale: false },
  blankSpec: { '毛重': '1.2' },
  finishedSpec: { '净重': '1.0' },
  drawingAnalysis: { dimensionAnnotations: [] },
  processSnapshot: { processSelection: [{ name: 'CNC 精铣', costType: 'time', minutes: 20 }] }
};

test('本地审核直接识别重量、工时和明确技术要求遗漏', () => {
  const result = AIReviewer.review({
    ...baseQuote,
    blankSpec: { '毛重': '0.8' },
    finishedSpec: { '净重': '1.0' },
    partDescription: '要求热处理并进行阳极氧化，所有锐边去毛刺。',
    drawingAnalysis: { globalTolerance: '±0.01', dimensionAnnotations: [] },
    processSnapshot: { processSelection: [{ name: 'CNC 粗铣', costType: 'time', minutes: 0 }] }
  });

  assert.equal(result.status, 'warning');
  assert.ok(result.comments.some(item => item.includes('毛重小于净重')));
  assert.ok(result.comments.some(item => item.includes('未填写有效分钟数')));
  assert.ok(result.comments.some(item => item.includes('热处理')));
  assert.ok(result.comments.some(item => item.includes('表面处理')));
  assert.ok(result.comments.some(item => item.includes('去毛刺')));
  assert.ok(result.comments.some(item => item.includes('精加工工序')));
});

test('本地审核不对已具备保障工序的正常报价误报', () => {
  const result = AIReviewer.review({
    ...baseQuote,
    partDescription: '要求热处理并进行阳极氧化，所有锐边去毛刺。',
    drawingAnalysis: { globalTolerance: '±0.01', dimensionAnnotations: [] },
    processSnapshot: {
      processSelection: [
        { name: 'CNC 精铣', costType: 'time', minutes: 20 },
        { name: '热处理', costType: 'manual' },
        { name: '阳极氧化表面处理', costType: 'manual' },
        { name: '去毛刺', costType: 'manual' }
      ]
    }
  });

  assert.equal(result.status, 'pass');
  assert.deepEqual(result.comments, ['AI预审通过，报价基本合理']);
});
