const fs = require('fs');
const path = require('path');

const OUT_DIR = __dirname;
const WIDTH = 3200;
const HEIGHT = 1800;

const esc = (value) => String(value)
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;');

const text = (x, y, value, size = 28, fill = '#d7e4f4', weight = 400, anchor = 'start', extra = '') =>
  `<text x="${x}" y="${y}" font-size="${size}" fill="${fill}" font-weight="${weight}" text-anchor="${anchor}" ${extra}>${esc(value)}</text>`;

const line = (x1, y1, x2, y2, stroke = '#475569', width = 3, marker = false, dash = '') =>
  `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${stroke}" stroke-width="${width}" ${dash ? `stroke-dasharray="${dash}"` : ''} ${marker ? 'marker-end="url(#arrow)"' : ''}/>`;

const pill = (x, y, w, label, fill, stroke, textFill = '#e8f1fb') =>
  `<g><rect x="${x}" y="${y}" width="${w}" height="42" rx="21" fill="${fill}" stroke="${stroke}" stroke-width="2"/>${text(x + w / 2, y + 29, label, 23, textFill, 600, 'middle')}</g>`;

const baseSvg = (content, title, subtitle) => `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#07111f"/>
      <stop offset="48%" stop-color="#0b1728"/>
      <stop offset="100%" stop-color="#111827"/>
    </linearGradient>
    <radialGradient id="glow" cx="50%" cy="0%" r="80%">
      <stop offset="0%" stop-color="#0ea5e9" stop-opacity=".19"/>
      <stop offset="100%" stop-color="#0ea5e9" stop-opacity="0"/>
    </radialGradient>
    <filter id="shadow" x="-20%" y="-20%" width="140%" height="150%">
      <feDropShadow dx="0" dy="12" stdDeviation="12" flood-color="#000814" flood-opacity=".45"/>
    </filter>
    <marker id="arrow" markerWidth="12" markerHeight="12" refX="10" refY="6" orient="auto" markerUnits="strokeWidth">
      <path d="M0,0 L12,6 L0,12 z" fill="#38bdf8"/>
    </marker>
    <style>
      text { font-family: "Microsoft YaHei", "PingFang SC", "Noto Sans CJK SC", "Segoe UI", sans-serif; }
    </style>
  </defs>
  <rect width="3200" height="1800" fill="url(#bg)"/>
  <rect width="3200" height="1800" fill="url(#glow)"/>
  <path d="M0 142 H3200" stroke="#233249" stroke-width="2"/>
  ${text(80, 66, title, 48, '#f8fafc', 800)}
  ${text(80, 108, subtitle, 25, '#91a4bb', 400)}
  ${content}
</svg>`;

function businessCard({ x, number, title, accent, tag, lines, foot }) {
  const y = 320;
  const w = 350;
  const h = 760;
  return `
    <g filter="url(#shadow)">
      <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="24" fill="#101e31" stroke="#2c4058" stroke-width="2"/>
      <rect x="${x}" y="${y}" width="8" height="${h}" rx="4" fill="${accent}"/>
      <circle cx="${x + 48}" cy="${y + 58}" r="29" fill="${accent}" fill-opacity=".16" stroke="${accent}" stroke-width="2"/>
      ${text(x + 48, y + 68, number, 27, accent, 800, 'middle')}
      ${text(x + 90, y + 67, title, 32, '#f5f8fc', 700)}
      <rect x="${x + 24}" y="${y + 108}" width="${w - 48}" height="1" fill="#2c4058"/>
      ${lines.map((t, i) => `
        <circle cx="${x + 34}" cy="${y + 166 + i * 92}" r="5" fill="${accent}"/>
        ${text(x + 52, y + 176 + i * 92, t, 23, '#c8d5e5', i === 0 ? 600 : 400)}
      `).join('')}
      <rect x="${x + 24}" y="${y + 502}" width="${w - 48}" height="1" fill="#263a50"/>
      ${text(x + 28, y + 548, '阶段产出', 19, '#70849b', 700)}
      ${text(x + 28, y + 592, foot, 21, accent, 600)}
      <rect x="${x + 24}" y="${y + 668}" width="${w - 48}" height="58" rx="18" fill="${accent}" fill-opacity=".12"/>
      ${text(x + w / 2, y + 705, tag ? `${tag} · 业务节点` : '业务节点', 20, accent, 700, 'middle')}
      ${tag ? `<rect x="${x + w - 110}" y="${y + 27}" width="84" height="40" rx="20" fill="${accent}" fill-opacity=".15"/>${text(x + w - 68, y + 54, tag, 19, accent, 600, 'middle')}` : ''}
    </g>`;
}

function businessDiagram() {
  const startX = 80;
  const gap = 38;
  const cardW = 350;
  const xs = Array.from({ length: 8 }, (_, i) => startX + i * (cardW + gap));
  const cards = [
    {
      number: '01', title: '业务入口', accent: '#38bdf8', tag: '双入口',
      lines: ['报价中心查看历史', 'AI 分析工作台', '手工新建报价'],
      foot: 'React Router · /quotes/*'
    },
    {
      number: '02', title: '建立草稿', accent: '#22d3ee', tag: 'draft',
      lines: ['录入零件 / 材料 / 数量', '尺寸 · 精度 · 交期', '图纸上传至本地存储'],
      foot: 'POST /api/quotes'
    },
    {
      number: '03', title: '图纸理解', accent: '#a78bfa', tag: '分流',
      lines: ['DXF：实体 / 轮廓 / 孔位', 'DWG：WASM 转 DXF', 'STEP：网格；图片：AI 视觉'],
      foot: '解析失败 → 参数回退'
    },
    {
      number: '04', title: '参数确认', accent: '#818cf8', tag: '可视',
      lines: ['回写长宽高 / 材料 / 特征', 'STEP 原始网格缓存', '2D 轮廓拉伸为推断模型'],
      foot: 'Three.js 3D 预览与标注'
    },
    {
      number: '05', title: '成本计算', accent: '#f59e0b', tag: '确定性',
      lines: ['体积 × 密度 × 材料单价', '五道工序：人工 + 设备', '管理费 15% · 利润 20%'],
      foot: 'calculated / ai_quoted'
    },
    {
      number: '06', title: '智能预审', accent: '#f97316', tag: '双层',
      lines: ['DeepSeek：工艺与价格建议', '规则引擎：区间 / 占比 / 批量', '无 Key 或失败时自动降级'],
      foot: '建议辅助，不替代成本引擎'
    },
    {
      number: '07', title: '人工终审', accent: '#34d399', tag: '决策',
      lines: ['查看成本拆分与风险项', '批准 / 驳回 / 要求修改', '记录意见与审核时间'],
      foot: 'approved → finalized'
    },
    {
      number: '08', title: '交付沉淀', accent: '#2dd4bf', tag: '闭环',
      lines: ['PDF 报价单下载 / 打印', 'SQLite 保存报价与审核 JSON', '列表 / 详情追溯历史'],
      foot: '报价结果可解释、可复核'
    }
  ];

  const arrows = xs.slice(0, -1).map((x, i) =>
    line(x + cardW + 8, 700, xs[i + 1] - 10, 700, '#38bdf8', 4, true)
  ).join('');

  const routeBand = `
    ${pill(865, 195, 390, '路径 A · 手工录入参数', '#0f2b3e', '#38bdf8')}
    ${line(1260, 216, 1630, 216, '#334155', 3, true, '9 9')}
    ${pill(1645, 195, 540, '路径 B · 上传 CAD / 图片后自动提取', '#241f47', '#a78bfa')}
    ${line(2190, 216, 2375, 216, '#334155', 3, true, '9 9')}
    ${pill(2390, 195, 380, '两路在成本计算汇合', '#3b2a16', '#f59e0b')}
  `;

  const status = [
    ['draft', '#22d3ee'],
    ['calculated / ai_quoted', '#f59e0b'],
    ['ai_reviewed', '#f97316'],
    ['manually_reviewed', '#34d399'],
    ['finalized', '#2dd4bf']
  ];
  let statusX = 640;
  const statusItems = status.map(([label, color], i) => {
    const w = label.length > 14 ? 330 : 225;
    const item = `${pill(statusX, 1194, w, label, '#0d1b2b', color, color)}${i < status.length - 1 ? line(statusX + w + 12, 1215, statusX + w + 58, 1215, '#38bdf8', 3, true) : ''}`;
    statusX += w + 74;
    return item;
  }).join('');

  const supportLayer = `
    <rect x="80" y="1350" width="3040" height="340" rx="28" fill="#0b1727" stroke="#22354b" stroke-width="2"/>
    ${text(112, 1400, '系统支撑层', 27, '#91a4bb', 700)}
    ${text(112, 1438, '业务节点背后的技术职责与数据落点', 19, '#64748b', 400)}
    <g>
      <rect x="520" y="1390" width="560" height="240" rx="22" fill="#102338" stroke="#38bdf8" stroke-width="2"/>
      ${text(555, 1440, '交互与展示', 27, '#38bdf8', 700)}
      ${text(555, 1488, 'React · Router · Axios', 22, '#d5e3f2', 600)}
      ${text(555, 1530, '表单 / 列表 / 详情 / AI 工作台', 20, '#9db0c5', 400)}
      ${text(555, 1572, 'Three.js 三维预览与特征标注', 20, '#9db0c5', 400)}
    </g>
    <g>
      <rect x="1110" y="1390" width="560" height="240" rx="22" fill="#211d3a" stroke="#a78bfa" stroke-width="2"/>
      ${text(1145, 1440, '业务编排', 27, '#a78bfa', 700)}
      ${text(1145, 1488, 'Express REST API · Quote 模型', 22, '#e1dcfa', 600)}
      ${text(1145, 1530, '状态流转 / 成本计算 / 审核流程', 20, '#aaa2ca', 400)}
      ${text(1145, 1572, '错误处理与失败回退', 20, '#aaa2ca', 400)}
    </g>
    <g>
      <rect x="1700" y="1390" width="560" height="240" rx="22" fill="#302516" stroke="#f59e0b" stroke-width="2"/>
      ${text(1735, 1440, '智能与解析', 27, '#f59e0b', 700)}
      ${text(1735, 1488, 'DXF / DWG / STEP · DeepSeek', 22, '#f7dfae', 600)}
      ${text(1735, 1530, '图纸特征、网格、工艺和价格建议', 20, '#c5ad80', 400)}
      ${text(1735, 1572, '规则引擎提供可解释预审', 20, '#c5ad80', 400)}
    </g>
    <g>
      <rect x="2290" y="1390" width="750" height="240" rx="22" fill="#122d2a" stroke="#2dd4bf" stroke-width="2"/>
      ${text(2325, 1440, '数据与交付', 27, '#2dd4bf', 700)}
      ${text(2325, 1488, 'SQLite · 本地文件 · PDFKit', 22, '#c8f5ed', 600)}
      ${text(2325, 1530, '报价记录 + 计算 / 审核 JSON 持久化', 20, '#96c6bd', 400)}
      ${text(2325, 1572, '图纸、模型缓存、PDF 报价单', 20, '#96c6bd', 400)}
    </g>
  `;

  const content = `
    ${routeBand}
    ${arrows}
    ${cards.map((card, i) => businessCard({ ...card, x: xs[i] })).join('')}
    <rect x="80" y="1130" width="3040" height="170" rx="24" fill="#0b1727" stroke="#22354b" stroke-width="2"/>
    ${text(112, 1182, '核心状态链', 25, '#91a4bb', 700)}
    ${text(112, 1225, '驳回或修改可回到参数确认 / 成本计算', 20, '#64748b', 400)}
    ${statusItems}
    ${supportLayer}
  `;
  return baseSvg(
    content,
    '机加工 AI 智能报价系统｜业务整体链路',
    '从需求进入、图纸理解、成本计算与审核，到报价交付和历史沉淀的一体化闭环'
  );
}

const laneColors = {
  product: '#38bdf8',
  backend: '#a78bfa',
  frontend: '#34d399',
  verify: '#f59e0b'
};

function devCell(x, y, w, h, accent, title, lines, tag) {
  return `
    <g>
      <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="16" fill="#101d2d" stroke="#2b3e55" stroke-width="2"/>
      <rect x="${x}" y="${y}" width="6" height="${h}" rx="3" fill="${accent}"/>
      ${tag ? `<rect x="${x + w - 90}" y="${y + 13}" width="72" height="28" rx="14" fill="${accent}" fill-opacity=".15"/>${text(x + w - 54, y + 33, tag, 16, accent, 700, 'middle')}` : ''}
      ${text(x + 22, y + 34, title, 22, '#eef4fb', 700)}
      ${lines.map((t, i) => text(x + 22, y + 64 + i * 27, t, 18, '#aebfd2', 400)).join('')}
    </g>`;
}

function developmentDiagram() {
  const left = 286;
  const colGap = 18;
  const colW = 462;
  const headerY = 185;
  const rowY = [330, 550, 770, 990];
  const rowH = 190;
  const phases = [
    {
      no: '01', name: '需求与设计', note: '范围先行',
      product: ['设计文档明确完整报价闭环', '排除认证 / 权限，定义成功标准'],
      backend: ['技术选型：Node.js + Express', '数据存储：SQLite + 本地文件'],
      frontend: ['信息架构：列表 / 表单 / 详情', '规划手工与 AI 两条创建路径'],
      verify: ['实施计划拆为 11 个任务', 'API、模型、状态机先达成契约']
    },
    {
      no: '02', name: '工程骨架', note: '可运行',
      product: ['Monorepo：frontend / backend', '环境变量与启动说明落地'],
      backend: ['Express 路由、中间件、健康检查', 'Quote 模型 + Schema 自动迁移'],
      frontend: ['CRA + React Router + Axios', '导航与 4 个核心业务页面'],
      verify: ['后端 :3001 / 前端 :3000', 'CRA proxy 联通 /api']
    },
    {
      no: '03', name: '报价核心闭环', note: 'MVP',
      product: ['创建 → 计算 → 预审 → 人审', '明确 draft 至 finalized 状态'],
      backend: ['材料 / 密度 / 精度常量表', '五道工序 + 管理费 + 利润'],
      frontend: ['参数表单、报价列表与详情', '成本拆分、审核操作与状态展示'],
      verify: ['REST API 冒烟验证', '计算结果要求可解释、可复核']
    },
    {
      no: '04', name: '图纸与三维能力', note: '增强',
      product: ['CAD / 图片成为参数输入源', '保留人工确认与失败回退'],
      backend: ['DXF 解析；DWG WASM 转换', 'STEP → 网格并缓存模型 JSON'],
      frontend: ['上传 / 分析进度 / 参数确认', 'Three.js 预览与特征标注'],
      verify: ['用 DXF / DWG / STP 样本联调', '校验边界、孔位、网格端点']
    },
    {
      no: '05', name: 'AI 与交付完善', note: '智能化',
      product: ['AI 提供建议，确定性引擎定价', '人工保留最终业务决策'],
      backend: ['DeepSeek 视觉 + 报价建议', '规则预审、fallback、PDFKit'],
      frontend: ['AI 工作台串起 4 步操作', '风险建议 / 人审 / PDF 下载'],
      verify: ['有 Key / 无 Key 两种路径验证', '校验降级结果仍可完成报价']
    },
    {
      no: '06', name: '集成验收与演进', note: '交付',
      product: ['历史报价可查询、详情可追溯', '业务闭环达到原始成功标准'],
      backend: ['SQLite 保存计算与审核 JSON', '全局错误处理、文件持久化'],
      frontend: ['生产构建输出 build/', '页面路由和下载链路收口'],
      verify: ['当前：手工 / API 端到端验证', '下一步：自动化测试与生产加固']
    }
  ];

  const rowLabels = [
    ['产品 / 设计', '目标、范围、契约', laneColors.product],
    ['后端实现', 'API、数据、业务服务', laneColors.backend],
    ['前端实现', '页面、交互、可视化', laneColors.frontend],
    ['验证 / 交付', '联调、构建、质量门', laneColors.verify]
  ];

  const headers = phases.map((phase, i) => {
    const x = left + i * (colW + colGap);
    return `
      <g>
        <rect x="${x}" y="${headerY}" width="${colW}" height="105" rx="18" fill="#13243a" stroke="#2e435d" stroke-width="2"/>
        <circle cx="${x + 42}" cy="${headerY + 52}" r="27" fill="#38bdf8" fill-opacity=".16" stroke="#38bdf8" stroke-width="2"/>
        ${text(x + 42, headerY + 61, phase.no, 22, '#38bdf8', 800, 'middle')}
        ${text(x + 84, headerY + 46, phase.name, 27, '#f5f8fc', 700)}
        ${text(x + 84, headerY + 76, phase.note, 19, '#8194ab', 500)}
      </g>`;
  }).join('');

  const labels = rowLabels.map(([title, note, color], i) => `
    <g>
      <rect x="80" y="${rowY[i]}" width="186" height="${rowH}" rx="18" fill="${color}" fill-opacity=".11" stroke="${color}" stroke-width="2"/>
      ${text(104, rowY[i] + 76, title, 25, color, 700)}
      ${text(104, rowY[i] + 112, note, 17, '#8395aa', 400)}
    </g>`).join('');

  const cells = phases.map((phase, col) => {
    const x = left + col * (colW + colGap);
    return [
      devCell(x, rowY[0], colW, rowH, laneColors.product, phase.product[0], [phase.product[1]], col === 0 ? 'SPEC' : ''),
      devCell(x, rowY[1], colW, rowH, laneColors.backend, phase.backend[0], [phase.backend[1]], col === 2 ? 'CORE' : ''),
      devCell(x, rowY[2], colW, rowH, laneColors.frontend, phase.frontend[0], [phase.frontend[1]], col === 3 ? '3D' : ''),
      devCell(x, rowY[3], colW, rowH, laneColors.verify, phase.verify[0], [phase.verify[1]], col === 5 ? 'GATE' : '')
    ].join('');
  }).join('');

  const flowArrows = phases.slice(0, -1).map((_, i) => {
    const x = left + i * (colW + colGap) + colW + 4;
    return line(x, 237, x + colGap - 8, 237, '#38bdf8', 3, true);
  }).join('');

  const footer = `
    <rect x="80" y="1230" width="3040" height="110" rx="20" fill="#0b1727" stroke="#263b52" stroke-width="2"/>
    ${pill(112, 1264, 410, '本地开发：backend npm run dev', '#171d37', '#a78bfa', '#c4b5fd')}
    ${pill(542, 1264, 390, 'frontend npm start', '#102a28', '#34d399', '#6ee7b7')}
    ${pill(952, 1264, 365, '生产构建：npm run build', '#302516', '#f59e0b', '#fbbf24')}
    ${pill(1337, 1264, 495, '当前质量现状：暂无自动化测试文件', '#351c24', '#fb7185', '#fda4af')}
    ${pill(1852, 1264, 580, '生产化补齐：认证 / 安全 / 对象存储 / 监控', '#15293a', '#38bdf8', '#7dd3fc')}
    ${pill(2452, 1264, 635, '持续演进：更多 CAD · 模板库 · 历史对比', '#172b27', '#2dd4bf', '#5eead4')}
    <rect x="80" y="1380" width="3040" height="310" rx="26" fill="#0b1727" stroke="#263b52" stroke-width="2"/>
    ${text(112, 1432, '阶段质量门', 27, '#91a4bb', 700)}
    ${text(112, 1470, '每个阶段都必须保留“可运行、可验证、可回退”的交付物', 19, '#64748b', 400)}
    <g>
      <rect x="520" y="1420" width="570" height="210" rx="22" fill="#13243a" stroke="#38bdf8" stroke-width="2"/>
      ${text(555, 1470, '01 · 契约一致', 27, '#38bdf8', 700)}
      ${text(555, 1515, '设计文档、数据模型、REST API 对齐', 21, '#d1deec', 500)}
      ${text(555, 1555, '前后端围绕同一状态机与字段联调', 20, '#91a4bb', 400)}
    </g>
    <g>
      <rect x="1120" y="1420" width="570" height="210" rx="22" fill="#211d3a" stroke="#a78bfa" stroke-width="2"/>
      ${text(1155, 1470, '02 · 主链可用', 27, '#a78bfa', 700)}
      ${text(1155, 1515, '无 AI Key 时 fallback 仍能完成报价', 21, '#e1dcfa', 500)}
      ${text(1155, 1555, 'CAD 解析失败后允许人工确认参数', 20, '#aaa2ca', 400)}
    </g>
    <g>
      <rect x="1720" y="1420" width="570" height="210" rx="22" fill="#302516" stroke="#f59e0b" stroke-width="2"/>
      ${text(1755, 1470, '03 · 结果可解释', 27, '#f59e0b', 700)}
      ${text(1755, 1515, '成本公式、工序工时、审核意见可追溯', 21, '#f7dfae', 500)}
      ${text(1755, 1555, 'PDF 与详情页使用同一份报价数据', 20, '#c5ad80', 400)}
    </g>
    <g>
      <rect x="2320" y="1420" width="720" height="210" rx="22" fill="#172b27" stroke="#2dd4bf" stroke-width="2"/>
      ${text(2355, 1470, '04 · 上线前补齐', 27, '#2dd4bf', 700)}
      ${text(2355, 1515, '单元 / API / E2E 自动化测试', 21, '#c8f5ed', 500)}
      ${text(2355, 1555, '认证授权、文件安全、监控与备份', 20, '#96c6bd', 400)}
    </g>
  `;

  const content = `
    ${headers}
    ${flowArrows}
    ${labels}
    ${cells}
    ${footer}
  `;

  return baseSvg(
    content,
    '机加工 AI 智能报价系统｜开发过程',
    '以“先闭环、再增强、可降级、可解释”为主线，前后端并行推进并在每阶段完成联调验证'
  );
}

const outputs = [
  ['business-overall-flow.svg', businessDiagram()],
  ['development-process.svg', developmentDiagram()]
];

for (const [filename, svg] of outputs) {
  fs.writeFileSync(path.join(OUT_DIR, filename), svg, 'utf8');
}

async function renderPng() {
  let sharp;
  try {
    sharp = require(path.join(__dirname, '../../backend/node_modules/sharp'));
  } catch (error) {
    console.warn('Sharp unavailable; SVG files were generated, PNG rendering skipped.');
    return;
  }
  for (const [filename, svg] of outputs) {
    const pngName = filename.replace(/\.svg$/, '.png');
    await sharp(Buffer.from(svg), { density: 144 })
      .resize(WIDTH, HEIGHT)
      .png({ quality: 95, compressionLevel: 9 })
      .toFile(path.join(OUT_DIR, pngName));
    console.log(`generated ${pngName}`);
  }
}

renderPng().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
