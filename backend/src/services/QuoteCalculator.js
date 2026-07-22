
const MATERIAL_PRICES = {
  '钢材': 15,
  '铝材': 25,
  '铜材': 45,
  '不锈钢': 35
};

const PRECISION_FACTORS = {
  '低': 1.0,
  '中等': 1.2,
  '高': 1.5,
  '极高': 2.0
};

class QuoteCalculator {
  static calculate(quote) {
    const { material, length, width, height, diameter, quantity, precision } = quote;

    const volume = this.calculateVolume(length, width, height, diameter);
    const materialCost = this.calculateMaterialCost(material, volume);
    const laborCost = this.calculateLaborCost(volume, precision);
    const equipmentCost = this.calculateEquipmentCost(volume, precision);
    const overheadCost = (materialCost + laborCost + equipmentCost) * 0.15;
    const profit = (materialCost + laborCost + equipmentCost + overheadCost) * 0.2;

    const unitTotal = materialCost + laborCost + equipmentCost + overheadCost + profit;
    const total = unitTotal * quantity;

    return {
      materialCost: materialCost * quantity,
      laborCost: laborCost * quantity,
      equipmentCost: equipmentCost * quantity,
      overheadCost: overheadCost * quantity,
      profit: profit * quantity,
      total: total,
      unitPrice: unitTotal,
      breakdown: {
        volume,
        materialPricePerKg: MATERIAL_PRICES[material] || 20,
        precisionFactor: PRECISION_FACTORS[precision] || 1.2
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
    const density = 7.85;
    const weight = volume * density / 1000;
    const pricePerKg = MATERIAL_PRICES[material] || 20;
    return weight * pricePerKg;
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

