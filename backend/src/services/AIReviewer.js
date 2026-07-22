
class AIReviewer {
  static review(quote) {
    const { calculation, material, quantity } = quote;
    const comments = [];
    const suggestions = [];
    let status = 'pass';

    if (!calculation) {
      return { status: 'fail', comments: ['请先计算报价'], suggestions: [] };
    }

    if (calculation.total < 100) {
      comments.push('报价偏低，建议检查计算');
      status = 'warning';
    }

    if (calculation.total > 100000) {
      comments.push('报价较高，建议双人复核');
      status = 'warning';
    }

    if (calculation.materialCost / calculation.total > 0.6) {
      suggestions.push('材料成本占比过高，考虑优化用料');
    }

    if (quantity > 100) {
      suggestions.push('大批量订单，建议给与批量折扣');
    }

    if (['不锈钢', '铜材'].includes(material)) {
      suggestions.push('贵重材料，建议确认材料价格最新行情');
    }

    if (comments.length === 0 && status === 'pass') {
      comments.push('AI预审通过，报价基本合理');
    }

    return { status, comments, suggestions };
  }
}

module.exports = AIReviewer;

