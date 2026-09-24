const test = require('node:test');
const assert = require('node:assert/strict');
const QuoteCalculator = require('../src/services/QuoteCalculator');

test('报价公式应稳定计算材料、工时、损耗、税和数量', () => {
  const result = QuoteCalculator.calculate(
    { grossWeight: 2, netWeight: 1.5, quantity: 3 },
    {
      unitPrice: 10,
      processSelection: [
        { processCode: 'cnc', name: 'CNC', costType: 'time', hourlyRate: 120, minutes: 30 },
        { processCode: 'material-loss', name: '材料损耗', costType: 'percentage' },
        { processCode: 'anodizing', name: '阳极氧化', costType: 'weight', unitRate: 15 }
      ],
      strategy: { materialLossRate: 0.1, overheadRate: 0.1, profitRate: 0.2, taxRate: 0.13, sampleMultiplier: 1 }
    }
  );
  assert.equal(result.materialCost, 20);
  assert.equal(result.machiningCost, 60);
  assert.equal(result.additions[0].cost, 6);
  assert.equal(result.additions[1].cost, 22.5);
  assert.equal(result.total, 477.3798);
  assert.equal(result.formulaTrace.total.expression, '159.1266 × 3 + 0 = 477.3798');
});
