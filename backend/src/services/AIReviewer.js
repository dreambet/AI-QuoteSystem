
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
}

module.exports = AIReviewer;
