const MATERIAL_PRICES = {
  '钢材': 15,
  '铝材': 25,
  '铜材': 45,
  '不锈钢': 35
};

const MATERIAL_DENSITIES = {
  '钢材': 7.85,
  '铝材': 2.7,
  '铜材': 8.96,
  '不锈钢': 7.93
};

const PRECISION_FACTORS = {
  '低': 1.0,
  '中等': 1.2,
  '高': 1.5,
  '极高': 2.0
};

const PROCESSES = [
  { name: '下料', timeFactor: 0.1, costPerHour: 60 },
  { name: '粗加工', timeFactor: 0.3, costPerHour: 80 },
  { name: '精加工', timeFactor: 0.4, costPerHour: 100 },
  { name: '表面处理', timeFactor: 0.1, costPerHour: 50 },
  { name: '质检', timeFactor: 0.1, costPerHour: 40 }
];

class QuoteCalculator {
  static calculate(quote) {
    const { material, length, width, height, diameter, quantity, precision } = quote;

    // 1. 体积和重量计算
    const volume = this.calculateVolume(length, width, height, diameter);
    const density = MATERIAL_DENSITIES[material] || 7.85;
    const weight = volume * density / 1000;

    // 2. 材料成本
    const materialCostPerUnit = this.calculateMaterialCost(material, volume);

    // 3. 工序和工时分析
    const processBreakdown = this.calculateProcessBreakdown(volume, precision);
    const laborCostPerUnit = processBreakdown.totalLaborCost;
    const equipmentCostPerUnit = processBreakdown.totalEquipmentCost;

    // 4. 管理费用和利润
    const overheadCostPerUnit = (materialCostPerUnit + laborCostPerUnit + equipmentCostPerUnit) * 0.15;
    const profitPerUnit = (materialCostPerUnit + laborCostPerUnit + equipmentCostPerUnit + overheadCostPerUnit) * 0.2;

    // 5. 单价和总价
    const unitTotal = materialCostPerUnit + laborCostPerUnit + equipmentCostPerUnit + overheadCostPerUnit + profitPerUnit;
    const total = unitTotal * quantity;

    return {
      // 各项成本（总价）
      materialCost: materialCostPerUnit * quantity,
      laborCost: laborCostPerUnit * quantity,
      equipmentCost: equipmentCostPerUnit * quantity,
      overheadCost: overheadCostPerUnit * quantity,
      profit: profitPerUnit * quantity,
      total: total,
      unitPrice: unitTotal,

      // 详细计算依据
      breakdown: {
        // 基础参数
        volume: volume,
        weight: weight,
        materialPricePerKg: MATERIAL_PRICES[material] || 20,
        density: density,
        precisionFactor: PRECISION_FACTORS[precision] || 1.2,

        // 体积计算详情
        volumeCalculation: {
          type: diameter ? '圆柱体' : '长方体',
          dimensions: diameter
            ? `直径: ${diameter}mm, 高度: ${height || length || 100}mm`
            : `长: ${length || 100}mm, 宽: ${width || 50}mm, 高: ${height || 20}mm`,
          formula: diameter
            ? `V = π * r² * h / 1000 = ${(Math.PI * Math.pow(diameter/2, 2) * (height || length || 100) / 1000).toFixed(4)} cm³`
            : `V = l * w * h / 1000 = ${((length || 100) * (width || 50) * (height || 20) / 1000).toFixed(4)} cm³`
        },

        // 材料计算详情
        materialCalculation: {
          formula: `材料成本 = 重量 × 材料单价 = ${weight.toFixed(3)}kg × ${MATERIAL_PRICES[material] || 20}元/kg`,
          details: [
            `体积: ${volume.toFixed(4)} cm³`,
            `密度: ${density} g/cm³`,
            `重量: ${weight.toFixed(3)} kg`,
            `材料单价: ${MATERIAL_PRICES[material] || 20} 元/kg`,
            `材料成本: ${materialCostPerUnit.toFixed(2)} 元/件`
          ]
        },

        // 工序分解
        processBreakdown: processBreakdown
      }
    };
  }

  static calculateVolume(length, width, height, diameter) {
    if (diameter && diameter > 0) {
      const radius = diameter / 2;
      const h = height || length || 100;
      return Math.PI * radius * radius * h / 1000;
    }
    const l = length || 100;
    const w = width || 50;
    const h = height || 20;
    return l * w * h / 1000;
  }

  static calculateMaterialCost(material, volume) {
    const density = MATERIAL_DENSITIES[material] || 7.85;
    const weight = volume * density / 1000;
    const pricePerKg = MATERIAL_PRICES[material] || 20;
    return weight * pricePerKg;
  }

  static calculateProcessBreakdown(volume, precision) {
    const precisionFactor = PRECISION_FACTORS[precision] || 1.2;
    const baseComplexity = Math.sqrt(volume);

    const processes = PROCESSES.map(process => {
      const time = baseComplexity * process.timeFactor * precisionFactor / 10;
      const laborCost = time * process.costPerHour;
      const equipmentCost = time * process.costPerHour * 0.5;

      return {
        name: process.name,
        estimatedTime: time.toFixed(2),
        hourlyRate: process.costPerHour,
        laborCost: laborCost.toFixed(2),
        equipmentCost: equipmentCost.toFixed(2)
      };
    });

    const totalLaborCost = processes.reduce((sum, p) => sum + parseFloat(p.laborCost), 0);
    const totalEquipmentCost = processes.reduce((sum, p) => sum + parseFloat(p.equipmentCost), 0);

    return {
      processes,
      totalLaborCost,
      totalEquipmentCost,
      summary: {
        totalTime: processes.reduce((sum, p) => sum + parseFloat(p.estimatedTime), 0).toFixed(2),
        averageHourlyRate: 80,
        precisionApplied: precisionFactor
      }
    };
  }

  static calculateLaborCost(volume, precision) {
    const baseTime = Math.sqrt(volume) / 10;
    const precisionFactor = PRECISION_FACTORS[precision] || 1.2;
    const hourlyRate = 80;
    return baseTime * precisionFactor * hourlyRate;
  }

  static calculateEquipmentCost(volume, precision) {
    const baseCost = Math.sqrt(volume) * 0.5;
    const precisionFactor = PRECISION_FACTORS[precision] || 1.2;
    return baseCost * precisionFactor;
  }
}

module.exports = QuoteCalculator;

