const ExcelJS = require('exceljs');
const fs = require('fs/promises');
const path = require('path');

const CURRENCY_FORMAT = '¥#,##0.00;[Red]-¥#,##0.00';
const NUMBER_FORMAT = '#,##0.0000';
const CUSTOM_STATION_SLOTS = 6;

const STANDARD_STATIONS = [
  ['锻造坯料', /锻造/], ['金属粉末成型', /金属粉末|粉末成型/], ['激光焊接', /激光焊/],
  ['折弯', /折弯/], ['激光切割', /激光切割/], ['车/铣加工', /车|铣/],
  ['走心机加工', /走心/], ['CNC加工', /CNC|加工中心/i], ['磨床加工', /磨/],
  ['滚齿加工', /滚齿/], ['线割加工', /线割|线切割/], ['电泳', /电泳/],
  ['镭雕', /镭雕/], ['喷砂', /喷砂/], ['热处理', /热处理/],
  ['电镀/化学镀镍', /电镀|化学镀镍|镀镍/], ['氧化', /氧化|阳极/],
  ['全检', /全检/], ['包材', /包材|包装/]
];

const toNumber = value => {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const formatDate = value => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString('zh-CN');
};

class QuoteExcelGenerator {
  static async generate(quote, outputPath) {
    const workbook = new ExcelJS.Workbook();
    const sheet = this.createTemplate(workbook);
    const blankSpec = quote.blankSpec || {};
    const finishedSpec = quote.finishedSpec || {};
    const calculation = quote.calculation || {};
    const priceSnapshot = quote.priceSnapshot || {};
    const grossWeight = quote.grossWeight ?? blankSpec['毛重'] ?? calculation.inputs?.grossWeight;
    const netWeight = quote.netWeight ?? finishedSpec['净重'] ?? calculation.inputs?.netWeight;
    const materialPrice = priceSnapshot.unitPrice ?? calculation.inputs?.unitPrice;
    const residualWeight = toNumber(blankSpec['余料重量']);
    const residualPrice = toNumber(blankSpec['余料单价']);
    const residualAmount = residualWeight === null || residualPrice === null ? null : residualWeight * residualPrice;

    const setText = (address, value, fallback = '') => {
      sheet.getCell(address).value = value === undefined || value === null || value === '' ? fallback : String(value);
    };
    const setNumeric = (address, value, format, fallback = '/') => {
      const numeric = toNumber(value);
      const cell = sheet.getCell(address);
      cell.value = numeric === null ? fallback : numeric;
      if (numeric !== null) cell.numFmt = format;
    };
    const setMoney = (address, value, fallback = '/') => setNumeric(address, value, CURRENCY_FORMAT, fallback);

    sheet.getCell('A1').value = '产品核价单';
    setText('C2', quote.materialCode || quote.id || '/');
    setText('G2', quote.partName || '未命名零件');
    setText('C3', quote.material || blankSpec['材质'] || '/');
    setText('G3', blankSpec['形状'] || '/');
    setText('C4', this.buildRoute(quote));
    setText('C5', this.buildDimensions(blankSpec, finishedSpec, netWeight));

    setNumeric('B7', quote.quantity ?? calculation.quantity ?? blankSpec.MOQ, '#,##0', '/');
    setNumeric('D7', grossWeight, NUMBER_FORMAT, '/');
    setMoney('F7', materialPrice, '/');
    setMoney('H7', calculation.materialCost, '/');
    setNumeric('B8', blankSpec['密度'], NUMBER_FORMAT, '/');
    setNumeric('D8', residualWeight, NUMBER_FORMAT, '/');
    setMoney('F8', residualPrice, '/');
    setMoney('H8', residualAmount, '/');

    const { rows: displayRows, omitted } = this.buildStationRows(this.collectStations(quote));
    displayRows.forEach((entry, index) => this.fillStationRow(sheet, 11 + index, entry));

    const totalRow = 11 + displayRows.length;
    const displayedStationCost = Number(
      displayRows.reduce((total, entry) => total + (toNumber(entry?.cost) || 0), 0).toFixed(4)
    );
    setMoney(`F${totalRow}`, displayedStationCost, '/');
    setText(`G${totalRow}`, '已排除损耗率型工站');

    const summaryRow = totalRow + 1;
    setMoney(`B${summaryRow}`, calculation.overhead, '/');
    setMoney(`D${summaryRow}`, calculation.profit, '/');
    const subtotal = toNumber(calculation.subtotal);
    const profit = toNumber(calculation.profit);
    setMoney(`F${summaryRow}`, subtotal === null || profit === null ? null : subtotal + profit, '/');
    setMoney(`H${summaryRow}`, calculation.unitPrice, '/');

    const total = toNumber(calculation.total);
    const noteRow = summaryRow + 1;
    setText(`C${noteRow}`, `报价总额：${total === null ? '/' : `¥${total.toFixed(2)}`}${residualAmount === null ? '' : '（余料金额仅作记录，不参与报价）'}${omitted > 0 ? `；另有 ${omitted} 项自定义工站超出展示槽位未逐一列示，其成本已计入报价总额` : ''}`);
    const quoteRow = noteRow + 1;
    setText(`C${quoteRow}`, `报价：系统导出 / ${formatDate(new Date())}`);
    const approvalRow = quoteRow + 1;
    setText(`C${approvalRow}`, quote.manualReview?.status === 'approved'
      ? `批准：已通过 / ${formatDate(quote.manualReview.reviewedAt)}`
      : '批准：待人工审核');

    sheet.pageSetup = { ...sheet.pageSetup, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9, horizontalCentered: true };
    try {
      await fs.mkdir(path.dirname(outputPath), { recursive: true });
      await workbook.xlsx.writeFile(outputPath);
    } catch (err) {
      // 半途失败会留下损坏文件，删除残留后向上抛由路由统一处理
      await fs.unlink(outputPath).catch(() => {});
      throw err;
    }
    return outputPath;
  }

  static buildRoute(quote) {
    const selected = quote.processSnapshot?.processSelection || [];
    return selected.filter(item => item.costType !== 'percentage').map(item => item.name).filter(Boolean).join('、') || '未选择工站';
  }

  static buildDimensions(blankSpec, finishedSpec, netWeight) {
    const dimensions = [
      ['形状', blankSpec['形状']], ['外径', blankSpec['外径'] || finishedSpec['外径']],
      ['料长', blankSpec['料长'] || finishedSpec['料长']], ['料宽', blankSpec['料宽'] || finishedSpec['料宽']],
      ['料厚', blankSpec['料厚'] || finishedSpec['料厚']], ['净重(KG)', netWeight]
    ].filter(([, value]) => value !== undefined && value !== null && value !== '');
    return dimensions.map(([label, value]) => `${label}：${value}`).join('    ') || '/';
  }

  static collectStations(quote) {
    const calculation = quote.calculation || {};
    const detailMap = new Map();
    [...(calculation.processes || []), ...(calculation.additions || [])].forEach(item => {
      const key = item.processCode || item.name;
      if (key) detailMap.set(key, item);
    });
    const selected = quote.processSnapshot?.processSelection || [];
    const source = selected.length ? selected : [...(calculation.processes || []), ...(calculation.additions || [])];
    const seen = new Set();
    return source.reduce((stations, item) => {
      const key = item.processCode || item.name;
      if (!key || seen.has(key) || item.costType === 'percentage') return stations;
      seen.add(key);
      const detail = detailMap.get(key) || {};
      stations.push({ ...item, ...detail, processCode: item.processCode || detail.processCode, name: item.name || detail.name });
      return stations;
    }, []);
  }

  static buildStationRows(stations) {
    const remaining = [...stations];
    const standardRows = STANDARD_STATIONS.map(([name, pattern]) => {
      const index = remaining.findIndex(item => pattern.test(`${item.processCode || ''} ${item.name || ''}`));
      if (index < 0) return { name };
      return remaining.splice(index, 1)[0];
    });
    const customRows = remaining.slice(0, CUSTOM_STATION_SLOTS);
    const omitted = remaining.length - customRows.length;
    while (customRows.length < CUSTOM_STATION_SLOTS) customRows.push(null);
    return { rows: standardRows.concat(customRows), omitted };
  }

  static fillStationRow(sheet, row, station) {
    const setText = (address, value) => { sheet.getCell(address).value = value; };
    const setNumeric = (address, value, format) => {
      const numeric = toNumber(value);
      sheet.getCell(address).value = numeric === null ? '/' : numeric;
      if (numeric !== null) sheet.getCell(address).numFmt = format;
    };
    if (!station || !station.costType) {
      if (!station && row >= 11 + STANDARD_STATIONS.length) {
        sheet.getRow(row).hidden = true;
        return;
      }
      setText(`C${row}`, '未使用');
      setText(`D${row}`, '/');
      setText(`E${row}`, '/');
      setText(`F${row}`, '/');
      setText(`G${row}`, '未同步');
      return;
    }
    setText(`A${row}`, station.name || '其他工站');
    const labels = { time: '按时长', weight: '按重量', manual: '固定金额' };
    setText(`C${row}`, labels[station.costType] || station.costType);
    const rate = station.costType === 'time' ? station.hourlyRate : station.costType === 'weight' ? station.unitRate : station.amount;
    setNumeric(`D${row}`, rate, CURRENCY_FORMAT);
    setNumeric(`E${row}`, station.costType === 'time' ? station.minutes : null, NUMBER_FORMAT);
    setNumeric(`F${row}`, station.cost, CURRENCY_FORMAT);
    setText(`G${row}`, station.formula || this.describeStation(station));
  }

  static createTemplate(workbook) {
    const sheet = workbook.addWorksheet('产品核价单', {
      pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9, horizontalCentered: true },
      views: [{ showGridLines: false }]
    });
    const stationRows = STANDARD_STATIONS.length + CUSTOM_STATION_SLOTS;
    const totalRow = 11 + stationRows;
    const summaryRow = totalRow + 1;
    const noteRow = summaryRow + 1;
    const quoteRow = noteRow + 1;
    const approvalRow = quoteRow + 1;
    const widths = [13, 13, 16, 15, 17, 15, 17, 17];
    sheet.columns = widths.map(width => ({ width }));

    sheet.mergeCells('A1:H1');
    sheet.mergeCells('A2:B2'); sheet.mergeCells('C2:D2'); sheet.mergeCells('E2:F2'); sheet.mergeCells('G2:H2');
    sheet.mergeCells('A3:B3'); sheet.mergeCells('C3:D3'); sheet.mergeCells('E3:F3'); sheet.mergeCells('G3:H3');
    sheet.mergeCells('A4:B4'); sheet.mergeCells('C4:H4');
    sheet.mergeCells('A5:B5'); sheet.mergeCells('C5:H5');
    sheet.mergeCells('A6:H6'); sheet.mergeCells('A9:H9');

    sheet.getCell('A1').value = '产品核价单';
    sheet.getCell('A2').value = '图号'; sheet.getCell('E2').value = '名称';
    sheet.getCell('A3').value = '材质'; sheet.getCell('E3').value = '材料形状';
    sheet.getCell('A4').value = '工艺路线'; sheet.getCell('A5').value = '材料尺寸';
    sheet.getCell('A6').value = '1.材料成本核价';
    sheet.getRow(7).values = ['数量', null, '材料毛重/KG', null, '材料单价', null, '材料总成本', null];
    sheet.getRow(8).values = ['材料密度', null, '余料重量/KG', null, '余料单价', null, '余料金额', null];
    sheet.getCell('A9').value = '2.工艺成本核价';
    sheet.getRow(10).values = ['工站/工艺', null, '计费类型', '费率或单价', '加工时间(分钟)', '工艺成本', '计算说明', null];
    sheet.mergeCells('A10:B10'); sheet.mergeCells('G10:H10');

    const stationNames = STANDARD_STATIONS.map(([name]) => name).concat(
      Array.from({ length: CUSTOM_STATION_SLOTS }, (_, index) => `其他工站 ${index + 1}`)
    );
    stationNames.forEach((name, index) => {
      const row = 11 + index;
      sheet.mergeCells(`A${row}:B${row}`);
      sheet.mergeCells(`G${row}:H${row}`);
      sheet.getCell(`A${row}`).value = name;
    });

    sheet.mergeCells(`A${totalRow}:E${totalRow}`);
    sheet.mergeCells(`G${totalRow}:H${totalRow}`);
    sheet.getCell(`A${totalRow}`).value = '工艺成本合计';
    sheet.getCell(`G${totalRow}`).value = '已排除损耗率型工站';
    sheet.getRow(summaryRow).values = ['管销成本', null, '利润', null, '加工未税单价', null, '报价单价', null];
    sheet.mergeCells(`A${noteRow}:B${noteRow}`); sheet.mergeCells(`C${noteRow}:H${noteRow}`);
    sheet.mergeCells(`A${quoteRow}:B${quoteRow}`); sheet.mergeCells(`C${quoteRow}:H${quoteRow}`);
    sheet.mergeCells(`A${approvalRow}:B${approvalRow}`); sheet.mergeCells(`C${approvalRow}:H${approvalRow}`);
    sheet.getCell(`A${noteRow}`).value = '备注';
    sheet.getCell(`A${quoteRow}`).value = '报价/日期';
    sheet.getCell(`A${approvalRow}`).value = '批准/日期';

    const border = { top: { style: 'thin', color: { argb: 'FF7F8C8D' } }, bottom: { style: 'thin', color: { argb: 'FF7F8C8D' } }, left: { style: 'thin', color: { argb: 'FF7F8C8D' } }, right: { style: 'thin', color: { argb: 'FF7F8C8D' } } };
    for (let row = 1; row <= approvalRow; row += 1) {
      const current = sheet.getRow(row);
      current.height = row === 1 ? 28 : (row === 4 || row === 5 ? 24 : 22);
      for (let column = 1; column <= 8; column += 1) {
        const cell = current.getCell(column);
        cell.font = { name: 'Arial', size: 10, color: { argb: 'FF1F2937' } };
        cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
        cell.border = border;
      }
    }
    sheet.getCell('A1').font = { name: 'Arial', size: 16, bold: true, color: { argb: 'FFFFFFFF' } };
    sheet.getCell('A1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F4E78' } };
    sheet.getCell('A1').alignment = { horizontal: 'center', vertical: 'middle' };
    ['A6', 'A9'].forEach(address => {
      const cell = sheet.getCell(address);
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9EAF7' } };
      cell.font = { name: 'Arial', size: 11, bold: true, color: { argb: 'FF1F4E78' } };
      cell.alignment = { horizontal: 'left', vertical: 'middle' };
    });
    for (let column = 1; column <= 8; column += 1) {
      const header = sheet.getRow(10).getCell(column);
      header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF5B9BD5' } };
      header.font = { name: 'Arial', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
    }
    [2, 3, 4, 5].forEach(row => {
      sheet.getCell(`A${row}`).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF3F6F9' } };
    });
    sheet.getCell('E2').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF3F6F9' } };
    sheet.getCell('E3').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF3F6F9' } };
    [7, 8].forEach(row => {
      for (let column = 1; column <= 8; column += 1) {
        sheet.getRow(row).getCell(column).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FBFE' } };
      }
    });
    for (let column = 1; column <= 8; column += 1) {
      const cell = sheet.getRow(summaryRow).getCell(column);
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEAF2F8' } };
      cell.font = { name: 'Arial', size: 10, bold: true, color: { argb: 'FF1F4E78' } };
    }
    [noteRow, quoteRow, approvalRow].forEach(row => {
      sheet.getCell(`A${row}`).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF3F6F9' } };
      sheet.getCell(`A${row}`).alignment = { horizontal: 'center', vertical: 'middle' };
      sheet.getCell(`C${row}`).alignment = { horizontal: 'left', vertical: 'middle', wrapText: true };
    });
    sheet.getCell(`A${totalRow}`).font = { name: 'Arial', size: 10, bold: true, color: { argb: 'FF1F4E78' } };
    sheet.getCell(`F${totalRow}`).font = { name: 'Arial', size: 10, bold: true, color: { argb: 'FF1F4E78' } };
    return sheet;
  }

  static describeStation(station) {
    if (station.costType === 'time') return '工费率 × 加工时间';
    if (station.costType === 'weight') return '单位费率 × 净重';
    if (station.costType === 'manual') return '人工填写金额';
    return '/';
  }
}

module.exports = QuoteExcelGenerator;
