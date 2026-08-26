
class AIReviewer {
  static review(quote) {
    const { calculation, material, quantity, priceSnapshot } = quote;
    const comments = [];
    const suggestions = [];
    let status = 'pass';

    if (!calculation) {
      return { status: 'fail', comments: ['请先计算报价'], suggestions: [] };
    }

    const total = Number(calculation.total || 0);
    const K = Number(calculation.materialCost || 0);   // 材料成本
    const R = Number(calculation.machiningCost || 0);  // 机加工成本
    const T = Number(calculation.subtotal || 0) || total; // 小计

    if (total > 0 && total < 100) {
      comments.push('报价偏低，建议检查毛重、单价与加工时长');
      status = 'warning';
    }
    if (total > 100000) {
      comments.push('报价较高，建议双人复核');
      status = 'warning';
    }

    // 材料成本占比（相对小计 T）
    if (T > 0 && K / T > 0.6) {
      suggestions.push('材料成本占比过高，考虑优化用料或确认毛重');
    }
    // 机加工成本占比
    if (T > 0 && R / T > 0.5) {
      suggestions.push('机加工成本占比较高，可复核工序与加工时长');
    }

    if (quantity > 100) {
      suggestions.push('大批量订单，建议给予批量折扣');
    }

    // 单价确认/行情检查（核心：市场价波动提醒）
    if (priceSnapshot) {
      if (priceSnapshot.source === 'missing' || priceSnapshot.unitPrice == null || priceSnapshot.unitPrice === 0) {
        comments.push('材料单价缺失，请先确认单价后再生成报价');
        status = 'warning';
      } else if (priceSnapshot.stale) {
        comments.push('材料单价已过期或未确认，市场价格波动，请确认最新单价');
        status = 'warning';
      }
    } else {
      comments.push('未记录单价快照，建议重新计算以留存价格确认信息');
      status = 'warning';
    }

    // 贵重/特殊材料提醒
    if (['不锈钢', '铜材', 'S31603', 'S30408'].includes(material)) {
      suggestions.push('贵重/特殊材料，建议确认材料价格最新行情');
    }

    if (comments.length === 0 && status === 'pass') {
      comments.push('AI预审通过，报价基本合理');
    }

    return { status, comments, suggestions };
  }

  /**
   * 本地基线层（情形A：同 materialCode = 同产品的历次报价）。
   * 所有涉价计算在此完成，输出只含枚举/倍数/工序名，供 LLM 语义层解读，不含价格数字。
   * historyRows: 同 materialCode 历史报价（不含本次），按 updatedAt 倒序，最多5条。
   */
  static computeHistoryBaseline(quote, historyRows) {
    if (!Array.isArray(historyRows) || !historyRows.length) {
      return { firstQuote: true };
    }
    const baseline = { firstQuote: false, deviation: null, deviationLevel: null, processDiff: '', durationFlags: [] };

    // 1) 单件价(W)偏离：与历史均值比较（等级输出给 LLM，倍数仅本地留存供前端展示）
    const currentW = Number((quote.calculation && quote.calculation.unitPrice) || 0);
    const histW = historyRows
      .map(r => Number((r.calculation && r.calculation.unitPrice) || 0))
      .filter(v => v > 0);
    if (currentW > 0 && histW.length) {
      const avg = histW.reduce((a, b) => a + b, 0) / histW.length;
      const dev = Math.abs(currentW - avg) / avg;
      baseline.deviationLevel = dev;
      baseline.deviation = dev > 0.3 ? '高' : dev > 0.1 ? '偏高' : '正常';
    }

    // 2) 工序集合差异（对比最近一次报价）
    const latest = historyRows[0];
    const curNames = ((quote.processSnapshot && quote.processSnapshot.processSelection) || []).map(p => p.name);
    const histNames = ((latest.processSnapshot && latest.processSnapshot.processSelection) || []).map(p => p.name);
    const removed = histNames.filter(n => !curNames.includes(n));
    const added = curNames.filter(n => !histNames.includes(n));
    if (removed.length || added.length) {
      baseline.processDiff = [
        removed.length ? `较历史减少：${removed.join('、')}` : '',
        added.length ? `较历史增加：${added.join('、')}` : ''
      ].filter(Boolean).join('；');
    }

    // 3) 同工序时长倍数异常（对比最近一次，≥3倍或≤1/3 视为异常）
    for (const cur of (quote.processSnapshot && quote.processSnapshot.processSelection) || []) {
      if (cur.costType !== 'time' || !(cur.minutes > 0)) continue;
      const hist = ((latest.processSnapshot && latest.processSnapshot.processSelection) || []).find(p => p.name === cur.name);
      if (hist && hist.minutes > 0) {
        const ratio = cur.minutes / hist.minutes;
        if (ratio >= 3 || ratio <= 1 / 3) {
          baseline.durationFlags.push({ process: cur.name, multiple: Math.round(ratio * 10) / 10 });
        }
      }
    }
    return baseline;
  }
}

module.exports = AIReviewer;
