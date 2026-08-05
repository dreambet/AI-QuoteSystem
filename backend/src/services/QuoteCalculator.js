/**
 * 报价计算引擎（按《计算公式总结.md》与成本分析.xls 完整重写）。
 *
 * 计算链：
 *   K = 毛重 × 单价                              // 材料成本（未税）
 *   Q_i(机加工) = 工费率 / 60 × 加工时长(分钟)     // 单制程成本
 *   R = Σ Q_i(机加工)                            // 机加工成本（未含税）
 *   Q_材料损耗 = R × 材料损耗率
 *   Q_刀具损耗 = R × 刀具损耗率
 *   Q_阳极 = unitRate(15) × 净重                  // 重量型
 *   Q_固定附加 = 人工金额                          // 钝化/镀镍/镭雕/全检/包材/清洗/酸洗钝化
 *   S = (R + Σ附加Q) × 管销率                     // 管销
 *   T = K + R + S + Σ附加Q                        // 小计
 *   U = T × 利润率                                // 利润
 *   V = (T + U) × (1 + 税率)                      // 合计成本（含税）
 *   W = V × 样品倍率                              // 样品价格（产品5倍率=1，W=V）
 *
 * 静态、确定性、同输入同输出。
 */

const num = (value, fallback = 0) => {
  const n = typeof value === 'string' ? parseFloat(value) : Number(value);
  return Number.isFinite(n) ? n : fallback;
};

const round = (value, digits = 4) => {
  const f = Math.pow(10, digits);
  return Math.round((value + Number.EPSILON) * f) / f;
};

class QuoteCalculator {
  /**
   * @param quote 报价对象（含 grossWeight/netWeight/quantity）
   * @param options { processSelection, strategy, unitPrice, setupFee }
   *   - processSelection: [{ processCode, name, costType, hourlyRate, minutes, unitRate, rate, amount }]
   *       costType: 'time' | 'percentage' | 'weight' | 'manual'
   *   - strategy: { overheadRate, profitRate, taxRate, sampleMultiplier, materialLossRate, toolLossRate }
   *   - unitPrice: 用户确认的材料单价（元/kg）
   *   - setupFee: 打样调机费（样品单叠加，量产为 0）
   */
  static calculate(quote, options = {}) {
    const { processSelection = [], strategy = {}, unitPrice: inputUnitPrice = null, setupFee = 0 } = options;

    const grossWeight = num(quote.grossWeight);
    const netWeight = num(quote.netWeight);
    const quantity = Math.max(1, num(quote.quantity, 1));
    const price = num(inputUnitPrice);
    const fee = num(setupFee);

    const rates = {
      overheadRate: num(strategy.overheadRate),
      profitRate: num(strategy.profitRate),
      taxRate: strategy.taxRate == null ? 0.13 : num(strategy.taxRate),
      sampleMultiplier: strategy.sampleMultiplier == null ? 1 : num(strategy.sampleMultiplier),
      materialLossRate: num(strategy.materialLossRate),
      toolLossRate: num(strategy.toolLossRate)
    };

    // 1. 材料成本 K = 毛重 × 单价
    const K = round(grossWeight * price);

    // 2. 机加工单制程成本 Q = 工费率/60 × 分钟；R = Σ 机加工 Q
    const machining = [];
    let R = 0;
    for (const sel of processSelection) {
      if (sel.costType !== 'time') continue;
      const hourlyRate = num(sel.hourlyRate);
      const minutes = num(sel.minutes);
      const Q = minutes > 0 ? round((hourlyRate / 60) * minutes) : 0;
      R += Q;
      machining.push({
        processCode: sel.processCode,
        name: sel.name,
        costType: 'time',
        hourlyRate,
        minutes,
        cost: Q,
        formula: minutes > 0 ? `${hourlyRate}/60 × ${minutes} = ${Q}` : '未填写加工时长'
      });
    }
    R = round(R);

    // 3. 附加费用（损耗率型依赖 R，重量型依赖净重，固定型依赖金额）
    const additions = [];
    let additionsTotal = 0;
    for (const sel of processSelection) {
      if (sel.costType === 'time') continue;
      let Q = 0;
      let formula = '';
      if (sel.costType === 'percentage') {
        const rate = sel.rate != null ? num(sel.rate) : this._defaultLossRate(sel.processCode, rates);
        Q = round(R * rate);
        formula = `${R} × ${rate} = ${Q}`;
      } else if (sel.costType === 'weight') {
        const unitRate = num(sel.unitRate);
        Q = round(unitRate * netWeight);
        formula = `${unitRate} × ${netWeight}(净重) = ${Q}`;
      } else if (sel.costType === 'manual') {
        Q = round(num(sel.amount));
        formula = `人工填写 ${Q}`;
      } else {
        continue;
      }
      additionsTotal += Q;
      additions.push({
        processCode: sel.processCode,
        name: sel.name,
        costType: sel.costType,
        rate: sel.costType === 'percentage' ? (sel.rate != null ? num(sel.rate) : this._defaultLossRate(sel.processCode, rates)) : null,
        unitRate: sel.costType === 'weight' ? num(sel.unitRate) : null,
        amount: sel.costType === 'manual' ? num(sel.amount) : null,
        cost: Q,
        formula
      });
    }
    additionsTotal = round(additionsTotal);

    // 4. 管销 S = (R + Σ附加Q) × 管销率
    const S = round((R + additionsTotal) * rates.overheadRate);

    // 5. 小计 T = K + R + S + Σ附加Q
    const T = round(K + R + S + additionsTotal);

    // 6. 利润 U = T × 利润率
    const U = round(T * rates.profitRate);

    // 7. 含税成本 V = (T + U) × (1 + 税率)
    const V = round((T + U) * (1 + rates.taxRate));

    // 8. 样品价格 W = V × 样品倍率
    const W = round(V * rates.sampleMultiplier);

    // 9. 单价/总价
    const unitPrice = W;
    const total = round(unitPrice * quantity + fee);

    return {
      // 顶层金额（单件口径，便于详情页/PDF 直接消费）
      materialCost: K,
      machiningCost: R,
      overhead: S,
      subtotal: T,
      profit: U,
      taxIncluded: V,
      samplePrice: W,
      setupFee: fee,
      unitPrice,
      total,
      quantity,

      // 明细
      processes: machining,
      additions,

      // 费率快照
      rates,

      // 输入快照
      inputs: {
        grossWeight,
        netWeight,
        unitPrice: price,
        quantity
      },

      // 可解释性：每步算式
      formulaTrace: {
        K: { label: '材料成本 K = 毛重 × 单价', expression: `${grossWeight} × ${price} = ${K}` },
        R: { label: '机加工成本 R = Σ 单制程成本', expression: `${machining.map(p => p.cost).join(' + ') || '0'} = ${R}` },
        additionsTotal: { label: '附加费用合计', expression: `${additions.map(a => a.cost).join(' + ') || '0'} = ${additionsTotal}` },
        S: { label: `管销 S = (R + 附加) × 管销率(${rates.overheadRate})`, expression: `(${R} + ${additionsTotal}) × ${rates.overheadRate} = ${S}` },
        T: { label: '小计 T = K + R + S + 附加', expression: `${K} + ${R} + ${S} + ${additionsTotal} = ${T}` },
        U: { label: `利润 U = T × 利润率(${rates.profitRate})`, expression: `${T} × ${rates.profitRate} = ${U}` },
        V: { label: `含税成本 V = (T + U) × (1 + 税率(${rates.taxRate}))`, expression: `(${T} + ${U}) × ${1 + rates.taxRate} = ${V}` },
        W: { label: `样品价格 W = V × 样品倍率(${rates.sampleMultiplier})`, expression: `${V} × ${rates.sampleMultiplier} = ${W}` },
        total: { label: '总价 = 单价 × 数量 + 调机费', expression: `${unitPrice} × ${quantity} + ${fee} = ${total}` }
      },

      // 兼容旧字段名（部分老展示代码引用），指向新值，避免 undefined
      laborCost: 0,
      equipmentCost: 0
    };
  }

  static _defaultLossRate(processCode, rates) {
    if (processCode === 'material-loss') return rates.materialLossRate;
    if (processCode === 'tool-loss') return rates.toolLossRate;
    return 0;
  }
}

module.exports = QuoteCalculator;
