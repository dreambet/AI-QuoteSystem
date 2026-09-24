const test = require('node:test');
const assert = require('node:assert/strict');
const QuoteExcelGenerator = require('../src/services/QuoteExcelGenerator');

test('核价单按工序确认顺序完整输出，AI 快照不进入计算说明', () => {
  const quote = {
    processSnapshot: {
      processSelection: [
        {
          processCode: 'cnc-3axis', name: 'CNC 三轴精铣', costType: 'time', hourlyRate: 120, minutes: 30,
          processSuggestionSnapshot: { source: 'AI 工艺初稿（已确认）', processType: 'cncMilling', basis: '存在平面与槽类特征' }
        },
        { processCode: 'material-loss', name: '材料损耗', costType: 'percentage', rate: 0.05 }
      ],
      processCatalogSnapshot: [
        { processCode: 'cnc-3axis', name: 'CNC 三轴精铣', costType: 'time', hourlyRate: 120 },
        { processCode: 'material-loss', name: '材料损耗', costType: 'percentage' },
        { processCode: 'grinding', name: '磨床加工', costType: 'time', hourlyRate: 160 }
      ]
    },
    calculation: {
      processes: [{ processCode: 'cnc-3axis', name: 'CNC 三轴精铣', costType: 'time', hourlyRate: 120, minutes: 30, cost: 60, formula: '120/60 × 30 = 60' }],
      additions: [{ processCode: 'material-loss', name: '材料损耗', costType: 'percentage', rate: 0.05, cost: 3, formula: '60 × 0.05 = 3' }]
    }
  };

  const stations = QuoteExcelGenerator.collectStations(quote);
  assert.deepEqual(stations.map(item => item.name), ['CNC 三轴精铣', '材料损耗', '磨床加工']);
  assert.equal(stations[2].adopted, false);
  assert.equal(QuoteExcelGenerator.buildStationRows(stations).rows.length, 3);
  assert.equal(QuoteExcelGenerator.buildCalculationDescription(stations[0]), '120/60 × 30 = 60');
});

test('没有已确认工序时，核价单用斜杠标识未使用项', () => {
  assert.deepEqual(QuoteExcelGenerator.buildStationRows([]).rows, [null]);
});
