/**
 * 本地 CAD 制造特征第一期增强版。
 *
 * 输出分为三层：图纸事实、制造特征、待人工确认的候选工序。
 * 圆形/圆柱面不会被断言为孔；无法可靠确定的数据不会直接计入报价。
 */
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

// 第一版可配置工时规则。它们负责“特征参数 → 建议分钟数”；工费率仍由工站目录人工维护。
const PROCESS_TIME_RULES = {
  cncMilling: { baseMinutes: 8, planarFactor: 1.15, cylindricalFactor: 1.61, curvedFactor: 2.07, meshFactor: 0.69, min: 8, max: 180 },
  drillingReview: { minutesPerFeature: 2.2, min: 5, max: 90 },
  contourReview: { minutesPerFeature: 3, min: 5, max: 90 },
  cylindricalReview: { minutesPerFeature: 1.8, min: 5, max: 90 },
  chamferReview: { minutesPerFeature: 1.2, min: 5, max: 90 },
  deburrReview: { minutesPerFeature: 0.8, min: 5, max: 90 },
  surfaceReview: { minutesPerFeature: 2.2, min: 5, max: 90 }
};

const round = (value, digits = 2) => {
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
};

const formatNumber = value => Number.isFinite(Number(value)) ? String(round(Number(value))) : '—';

const triangleNormalAndArea = (positions, a, b, c) => {
  const ax = positions[a * 3]; const ay = positions[a * 3 + 1]; const az = positions[a * 3 + 2];
  const bx = positions[b * 3]; const by = positions[b * 3 + 1]; const bz = positions[b * 3 + 2];
  const cx = positions[c * 3]; const cy = positions[c * 3 + 1]; const cz = positions[c * 3 + 2];
  const ux = bx - ax; const uy = by - ay; const uz = bz - az;
  const vx = cx - ax; const vy = cy - ay; const vz = cz - az;
  const nx = uy * vz - uz * vy;
  const ny = uz * vx - ux * vz;
  const nz = ux * vy - uy * vx;
  const twiceArea = Math.hypot(nx, ny, nz);
  if (twiceArea < 1e-9) return null;
  return { normal: [nx / twiceArea, ny / twiceArea, nz / twiceArea], area: twiceArea / 2 };
};

class ManufacturingFeatureService {
  analyze(parseResult) {
    if (!parseResult?.success) return this._empty();
    if (parseResult.format === 'STEP') return this._analyzeStep(parseResult);
    if (parseResult.format === 'DXF' || parseResult.format === 'DWG') return this._analyze2DDrawing(parseResult);
    return this._empty();
  }

  _empty() {
    return { features: [], processSuggestions: [], unresolved: [] };
  }

  _analyzeStep(parseResult) {
    const meshes = parseResult.model?.meshes || [];
    if (!meshes.length) return this._empty();
    const features = [];
    meshes.forEach((mesh, meshIndex) => {
      const faces = mesh.faces || [];
      faces.forEach(face => {
        const feature = this._analyzeStepFace(mesh, meshIndex, face);
        if (feature) features.push(feature);
      });
    });

    // 网格面用于定位；STEP 标准实体用于补充孔/倒角/圆角等语义候选。
    // 两者分别限量，避免大量平面面片挤掉更有价值的语义特征。
    const rankedFaces = features.sort((a, b) => (b.data?.area || 0) - (a.data?.area || 0)).slice(0, 60);
    const semanticFeatures = this._stepSemanticFeatures(parseResult.stepSemantics || {});
    const ranked = [...semanticFeatures, ...rankedFaces].slice(0, 80);
    const planar = ranked.filter(feature => feature.type === '平面加工面');
    const cylindrical = ranked.filter(feature => feature.type === '疑似圆柱面');
    const curved = ranked.filter(feature => feature.type === '曲面加工候选');
    const holeCandidates = ranked.filter(feature => feature.type === '孔/圆柱特征候选');
    const chamferCandidates = ranked.filter(feature => feature.type === '倒角/锥面候选');
    const filletCandidates = ranked.filter(feature => feature.type === '圆角候选');
    const cncRule = PROCESS_TIME_RULES.cncMilling;
    const complexity = planar.length + cylindrical.length * 1.4 + curved.length * 1.8 + meshes.length * 0.6;
    const processSuggestions = [];
    if (planar.length) {
      processSuggestions.push({
        id: 'cad-cnc-milling', processType: 'cncMilling', name: 'CNC 铣削（图纸建议）',
        minutes: clamp(Math.round(cncRule.baseMinutes + complexity * cncRule.planarFactor), cncRule.min, cncRule.max),
        confidence: clamp(round(0.72 + Math.min(complexity, 35) / 250, 2), 0.72, 0.86),
        featureIds: planar.map(feature => feature.id),
        calculationInputs: { planarFaces: planar.length, cylindricalCandidates: cylindrical.length, curvedCandidates: curved.length, meshCount: meshes.length },
        timeFormula: `建议工时 = ${cncRule.baseMinutes} + (${planar.length} + 1.4×${cylindrical.length} + 1.8×${curved.length} + 0.6×${meshes.length}) × ${cncRule.planarFactor} 分钟`,
        costFormula: '确认后工序成本 = 确认分钟数 ÷ 60 × 工费率（元/小时）',
        basis: `依据：本地识别 ${planar.length} 个平面加工面、${meshes.length} 个模型网格；分钟数仅为待确认初稿。`
      });
    }
    if (cylindrical.length) processSuggestions.push(this._reviewSuggestion('cad-cylindrical-review', 'cylindricalReview', '圆柱特征加工（待配置）', cylindrical, 'cylindricalReview', '疑似圆柱面可能对应孔、外圆或配合面，需确认后映射钻孔、车削或其他工站。'));
    if (holeCandidates.length) processSuggestions.push(this._reviewSuggestion('cad-hole-review', 'drillingReview', '孔加工（待确认）', holeCandidates, 'drillingReview', '依据 STEP 圆柱面实体及半径信息生成；仍需确认通/盲孔、深度、螺纹和加工方向。'));
    if (chamferCandidates.length) processSuggestions.push(this._reviewSuggestion('cad-chamfer-review', 'chamferReview', '倒角加工（待确认）', chamferCandidates, 'chamferReview', '依据 STEP 圆锥面实体生成；锥面也可能为锥孔或锥度外形，需确认。'));
    if (filletCandidates.length) processSuggestions.push(this._reviewSuggestion('cad-fillet-review', 'deburrReview', '圆角/去毛刺（待确认）', filletCandidates, 'deburrReview', '依据 STEP 环面实体生成；需确认是否为设计圆角、刀具圆角或去毛刺要求。'));
    if (curved.length) processSuggestions.push(this._reviewSuggestion('cad-surface-review', 'surfaceReview', '曲面加工（待配置）', curved, 'surfaceReview', '曲面区域可能需要多轴加工、成型刀具或其他工艺，需确认设备与装夹方案。'));

    const unresolved = [
      ...(curved.length ? ['曲面加工候选未包含刀路、装夹与设备能力信息；未确认前不会自动计入多轴或成型加工费用。'] : [])
    ];
    return { features: ranked, processSuggestions, unresolved };
  }

  _stepSemanticFeatures(semantics) {
    const formatGroups = groups => groups.slice(0, 4).map(item => `Ø${formatNumber(item.radius * 2)} × ${item.count}`).join('、');
    const features = [];
    if (semantics.cylindricalSurfaces) features.push({
      id: 'step-cylinder-semantic', type: '孔/圆柱特征候选',
      description: `STEP 定义 ${semantics.cylindricalSurfaces} 个圆柱面${semantics.cylindricalRadii?.length ? `（${formatGroups(semantics.cylindricalRadii)} mm）` : ''}；孔/外圆待确认`,
      confidence: 0.76, data: { source: 'stepSemantic', count: semantics.cylindricalSurfaces, radii: semantics.cylindricalRadii || [] }
    });
    if (semantics.conicalSurfaces) features.push({
      id: 'step-cone-semantic', type: '倒角/锥面候选',
      description: `STEP 定义 ${semantics.conicalSurfaces} 个圆锥面${semantics.conicalRadii?.length ? `（${formatGroups(semantics.conicalRadii)} mm）` : ''}；倒角/锥孔待确认`,
      confidence: 0.71, data: { source: 'stepSemantic', count: semantics.conicalSurfaces, radii: semantics.conicalRadii || [] }
    });
    if (semantics.toroidalSurfaces) features.push({
      id: 'step-torus-semantic', type: '圆角候选',
      description: `STEP 定义 ${semantics.toroidalSurfaces} 个环面；圆角/过渡面待确认`,
      confidence: 0.7, data: { source: 'stepSemantic', count: semantics.toroidalSurfaces, radii: semantics.toroidalRadii || [] }
    });
    if (semantics.splineSurfaces) features.push({
      id: 'step-spline-semantic', type: '自由曲面候选',
      description: `STEP 定义 ${semantics.splineSurfaces} 个样条曲面；可能需要曲面或多轴加工`,
      confidence: 0.68, data: { source: 'stepSemantic', count: semantics.splineSurfaces }
    });
    return features;
  }

  _reviewSuggestion(id, processType, name, features, ruleKey, basis) {
    const rule = PROCESS_TIME_RULES[ruleKey];
    const featureCount = features.reduce((sum, feature) => sum + (Number(feature.data?.count) || 1), 0);
    return {
      id, processType, name,
      minutes: clamp(Math.round(featureCount * rule.minutesPerFeature), rule.min, rule.max),
      confidence: features[0]?.confidence || 0.62,
      requiresConfiguration: true,
      featureIds: features.map(feature => feature.id),
      calculationInputs: { featureCount, minutesPerFeature: rule.minutesPerFeature },
      timeFormula: `建议工时 = ${featureCount} 项 × ${rule.minutesPerFeature} 分钟/项（范围 ${rule.min}–${rule.max} 分钟）`,
      costFormula: '确认后工序成本 = 确认分钟数 ÷ 60 × 工费率（元/小时）',
      basis: `依据：本地识别 ${featureCount} 项相关几何。${basis}`
    };
  }

  _analyzeStepFace(mesh, meshIndex, face) {
    const indices = mesh.indices || [];
    const positions = mesh.positions || [];
    const start = Math.max(0, (face.firstTriangle || 0) * 3);
    const end = Math.min(indices.length, ((face.lastTriangle ?? face.firstTriangle ?? 0) + 1) * 3);
    if (end - start < 3) return null;
    const sampleStep = Math.max(3, Math.floor((end - start) / 450) * 3);
    let nx = 0; let ny = 0; let nz = 0; let area = 0; let samples = 0;
    let minX = Infinity; let minY = Infinity; let minZ = Infinity;
    let maxX = -Infinity; let maxY = -Infinity; let maxZ = -Infinity;
    const seen = new Set();
    for (let i = start; i + 2 < end; i += sampleStep) {
      const a = indices[i]; const b = indices[i + 1]; const c = indices[i + 2];
      const triangle = triangleNormalAndArea(positions, a, b, c);
      if (triangle) { nx += triangle.normal[0]; ny += triangle.normal[1]; nz += triangle.normal[2]; area += triangle.area; samples += 1; }
      [a, b, c].forEach(index => {
        if (seen.has(index)) return;
        seen.add(index);
        const x = positions[index * 3]; const y = positions[index * 3 + 1]; const z = positions[index * 3 + 2];
        minX = Math.min(minX, x); minY = Math.min(minY, y); minZ = Math.min(minZ, z);
        maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); maxZ = Math.max(maxZ, z);
      });
    }
    if (!samples || !seen.size) return null;
    const coherence = Math.hypot(nx, ny, nz) / samples;
    const spans = [maxX - minX, maxY - minY, maxZ - minZ];
    const center = { x: (minX + maxX) / 2, y: (minY + maxY) / 2, z: (minZ + maxZ) / 2 };
    const data = { meshIndex, faceIndex: face.index, area: round(area), position: center };
    const id = `mf-${meshIndex}-${face.index}`;
    if (coherence >= 0.96) return { id, type: '平面加工面', description: `面积约 ${round(area)} mm² 的平面（本地几何识别）`, confidence: round(coherence, 2), data };
    const pairs = [[0, 1, 2], [0, 2, 1], [1, 2, 0]];
    const pair = pairs.find(([a, b, axis]) => {
      const diameter = (spans[a] + spans[b]) / 2;
      return diameter > 0.5 && Math.abs(spans[a] - spans[b]) / diameter < 0.16 && spans[axis] > diameter * 0.25;
    });
    if (pair) {
      const [a, b, axis] = pair;
      const diameter = (spans[a] + spans[b]) / 2;
      return { id, type: '疑似圆柱面', description: `约 Ø${round(diameter)} × ${round(spans[axis])} mm 的圆柱几何（孔/外圆待确认）`, confidence: 0.68, data: { ...data, diameter: round(diameter), length: round(spans[axis]), axis: ['X', 'Y', 'Z'][axis] } };
    }
    if (area >= 5 && coherence < 0.55) return { id, type: '曲面加工候选', description: `面积约 ${round(area)} mm² 的非平面区域（工艺待确认）`, confidence: 0.58, data };
    return null;
  }

  _analyze2DDrawing(parseResult) {
    const rawFeatures = parseResult.features || [];
    const dimensions = parseResult.dimensionAnnotations || [];
    const circles = rawFeatures.map((feature, index) => ({ feature, index })).filter(item => item.feature.type === '圆' && Number(item.feature.data?.r) > 0);
    const closedContours = rawFeatures.map((feature, index) => ({ feature, index })).filter(item => item.feature.type === '多段线' && item.feature.data?.closed);
    const textItems = rawFeatures.filter(feature => feature.type === '文本').map(feature => feature.data?.text || feature.description || '').filter(Boolean);
    const features = [];
    const diameterGroups = new Map();
    circles.forEach(item => {
      const diameter = round(Number(item.feature.data.r) * 2);
      const group = diameterGroups.get(String(diameter)) || { diameter, items: [] };
      group.items.push(item);
      diameterGroups.set(String(diameter), group);
    });
    [...diameterGroups.values()].sort((a, b) => b.items.length - a.items.length).slice(0, 20).forEach((group, index) => {
      const first = group.items[0];
      const isDimensioned = dimensions.some(dimension => dimension.type === '直径' && Number.isFinite(Number(dimension.value)) && Math.abs(Number(dimension.value) - group.diameter) <= Math.max(0.05, group.diameter * 0.01));
      features.push({ id: `dxf-circle-${group.diameter}-${index}`, type: isDimensioned ? '孔特征候选' : '圆特征候选', description: `Ø${formatNumber(group.diameter)} mm，${group.items.length} 处（${isDimensioned ? '有直径标注，仍需剖视确认孔深/通盲' : '孔/外圆/标注图形待确认'}）`, confidence: isDimensioned ? 0.76 : 0.66, data: { sourceFeatureIndex: first.index, diameter: group.diameter, count: group.items.length, position: first.feature.data } });
    });
    closedContours.slice(0, 20).forEach(item => {
      features.push({ id: `dxf-contour-${item.index}`, type: '槽/型腔轮廓候选', description: `闭合轮廓，${item.feature.data?.vertexCount || 0} 个顶点（外形/槽/型腔待确认）`, confidence: 0.64, data: { sourceFeatureIndex: item.index, position: item.feature.data?.position } });
    });
    const requirements = this._extractTextRequirements(textItems);

    const processSuggestions = [];
    const circleFeatures = features.filter(feature => feature.type === '圆特征候选' || feature.type === '孔特征候选');
    const contourFeatures = features.filter(feature => feature.type === '槽/型腔轮廓候选');
    if (contourFeatures.length) processSuggestions.push(this._reviewSuggestion('drawing-contour-review', 'contourReview', '槽/型腔/外形加工（待配置）', contourFeatures, 'contourReview', '闭合轮廓可能代表外形、型腔或局部视图，需结合视图与厚度确认。'));
    if (circleFeatures.length) processSuggestions.push(this._reviewSuggestion('drawing-circle-review', 'drillingReview', '孔/圆特征加工（待配置）', circleFeatures, 'drillingReview', '二维圆图元不等同于孔，需结合剖视、标注和技术要求确认。'));
    const unresolved = requirements.map(requirement => `检测到${requirement.label}：“${requirement.value}”；请人工确认后录入报价参数。`);
    return { features, processSuggestions, unresolved };
  }

  _extractTextRequirements(texts) {
    const rules = [
      { label: '材料线索', pattern: /(材料|材质|material|不锈钢|铝合金|碳钢|合金钢|铜合金|钛合金)[^\n；;]{0,50}/i },
      { label: '粗糙度线索', pattern: /(ra\s*\d+(?:\.\d+)?|粗糙度[^\n；;]{0,40})/i },
      { label: '热处理线索', pattern: /(热处理|淬火|回火|退火|时效|调质|渗碳|氮化)[^\n；;]{0,50}/i },
      { label: '表面处理线索', pattern: /(表面处理|阳极氧化|镀[锌镍铬]|发黑|喷砂|钝化|喷涂)[^\n；;]{0,50}/i },
      { label: '螺纹线索', pattern: /((?:m|g)\s*\d+(?:\s*[x×]\s*\d+(?:\.\d+)?)?[^\n；;]{0,30})/i }
    ];
    const found = [];
    rules.forEach(rule => {
      const match = texts.map(text => String(text).replace(/\\[A-Za-z][^;]*;/g, ' ').match(rule.pattern)).find(Boolean);
      if (match) found.push({ label: rule.label, value: match[0].trim() });
    });
    return found;
  }
}

module.exports = new ManufacturingFeatureService();
