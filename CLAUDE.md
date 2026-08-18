# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

机加工 AI 智能报价系统：上传 CAD 图纸（DWG/DXF/STEP/STP）-> AI 分析 -> **确认材料/产品规格 + 工序 + 单价** -> 按《成本分析.xls》公式链计算报价 -> AI 预审/人工审核 -> 导出 PDF 报价单。前后端分离单仓库，后端 Node.js + Express + **MySQL**，前端 Create React App + React Router + three.js。

> ⚠️ **图纸仅支持 CAD 格式（DWG/DXF/STEP/STP）**，PDF/图片上传与 AI 视觉分析链路已整体移除（防泄密），multer `fileFilter` 在 `quotes.js`/`upload.js` 两处拦截非法格式。

业务模型来源：`D:\Desktop\成本分析.xls` 与 `计算公式总结.md`（成本公式与工序目录的真相来源）。

## 常用命令

后端（在 `backend/` 目录）：
```bash
npm install
npm run dev          # nodemon 热重载，监听 src/，端口 3001
npm start            # 生产启动（node src/server.js）
npm run init-db      # 建表（ensureSchema，幂等）
npm run seed         # 种子数据修复（产品5样品倍率/阳极unitRate/牌号占位价/策略改名A-E/删density/删无用列与表，幂等）
npm run rebuild-db   # ⚠️ 破坏性：重建 schema，会清空报价数据
```

前端（在 `frontend/` 目录）：
```bash
npm install
npm start            # CRA 开发服务器，端口 3000，已配置 proxy 到 :3001
npm run build        # 生产构建到 build/
```

首次配置：`cp backend/.env.example backend/.env`，填 `DEEPSEEK_API_KEY` 与 MySQL 连接（`MYSQL_HOST/PORT/USER/PASSWORD/DATABASE`，库名默认 `quote`）。无 DeepSeek Key 时 AI 功能优雅降级。**后端依赖 MySQL 运行**，不再是 SQLite。

## 架构要点

### 数据存储：MySQL 多表 + JSON 列
`db.js` 用 `mysql2/promise` 连接池，`ensureSchema()` 建表。当前 **5 张表**：
- `quotes`：报价主表，23 列。嵌套对象（`calculation`/`aiReview`/`manualReview`/`drawingAnalysis`/`aiQuoteAnalysis`/`blankSpec`/`finishedSpec`/`priceSnapshot`/`processSnapshot`）存为 LONGTEXT JSON 列，`db.parseRow` 读取时反序列化。`materialCode`/`grossWeight`/`netWeight`/`strategyVersionId`(BIGINT)/`finalUnitPrice` 为独立列；`id` 应用层生成。
- `materials` + `material_prices`：材料牌号（S31603/S30408…）与带生效日期的单价历史（`status=active/historical`，`confirmedAt` 标记是否市场确认）。**materials 表已无 density 列**（密度参数不再使用）。
- `processes`：19 道工序目录，`costType` ∈ `time|percentage|weight|manual`，分别带 `hourlyRate`/`unitRate`/`fixedAmount`。**已无 unit 列**。
- `pricing_strategies`：报价策略，字段 `materialLossRate`/`toolLossRate`/`overheadRate`/`profitRate`/`taxRate`/`sampleMultiplier`/`setupFeeDefault` + `name`（唯一键）/`createdBy`/`changeReason`。预置 5 条（name `成本策略A..E`）。**已无 code 列**（原产品物码编码已删，改用 name 唯一识别）。

> ⚠️ **`part_masters` 与 `quote_events` 表已删除**（seed.js DROP，A 类无用清理）。旧的 `quotes.customer/usageContext/quoteType/partNumber/length/width/height/diameter/moq/deliveryDate/precision`、`materials.specification/priceUnit/density`、`pricing_strategies.version/config/publishedAt/status/setupFeeMin/...` 等列也已删。前端表单里的 `length/width/height/diameter/precision` 只是 formData 状态，**不持久化到 quotes 表独立列**（CAD 尺寸预填到 `blankSpec`/`finishedSpec` JSON）。

⚠️ **`db.query()` 直接返回行数组**（内部已 `const [rows] = pool.query()` 并 `rows.map(parseRow)`）。调用方写 `const rows = await db.query(sql)`，**不要再解构** `const [rows]`（会取到首行对象）。`getConnection()` 拿到的原始 connection 才用 `[rows]` 解构。db 还导出 `withTransaction()`。

### 自动迁移
`db.js` 的 `ensureSchema` 用 `INFORMATION_SCHEMA.COLUMNS` 检查缺失列并 `ALTER TABLE ADD COLUMN`（`quoteColumns` 清单）。新增 quotes 字段需同步改：`db.js` ensureSchema 的 CREATE TABLE + `quoteColumns` 清单、`Quote` 模型的 `quoteFields`/`jsonFields`/create/update。

### 成本计算公式（`QuoteCalculator.js`，按计算公式总结.md）
确定性公式链，单输入单输出。签名 `QuoteCalculator.calculate(quote, options = {})`：
```
K = 毛重 × 单价                      // 材料成本（未税）
Q_i(机加工) = 工费率/60 × 加工时长(分钟)   // 单制程成本
R = Σ 机加工 Q                       // 机加工成本
Q_损耗 = R × 损耗率（材料损耗/刀具损耗）
Q_阳极 = unitRate(15) × 净重           // weight 型
Q_固定附加 = 人工金额（钝化/镀镍/镭雕/全检/包材/清洗/酸洗钝化）
S = (R + Σ附加Q) × 管销率             // 管销
T = K + R + S + Σ附加Q               // 小计
U = T × 利润率                       // 利润
V = (T + U) × (1 + 税率)             // 含税成本
W = V × 样品倍率                     // 样品价格（产品5倍率=1，W=V）
总价 = W × 数量 + 打样调机费
```
输出含 `materialCost/machiningCost/overhead/subtotal/profit/taxIncluded/samplePrice/setupFee/unitPrice/total` + `processes`/`additions` 明细 + `formulaTrace`（每步算式，供详情页/PDF 展示）。路由 `/:id/calculate` 收 `processSelection/unitPrice/strategyId/strategyOverrides/setupFee`，写 `calculation/priceSnapshot/processSnapshot/strategyVersionId`。

### 三个「AI/规则」服务，勿混淆
- **`AIReviewer.js`**（`POST /:id/ai-review`）：纯规则引擎（总价区间、K/T 材料占比、R/T 机加工占比、单价缺失/过期提醒），不调外部 API。状态 `ai_reviewed`。
- **`DeepSeekService.js`**（`POST /:id/analyze-drawing`、`POST /:id/ai-quote`）：真 LLM 调用（`deepseek-chat` + `json_object`）。fallback 从 `processes` 表取真实工序。**prompt 已移除 complexity 字段**——AI 不再输出复杂程度，前端活跃组件也已无复杂度展示（仅 `LegacyAIQuoteCreation` 死代码里残留引用，未渲染）。
- **`QuoteCalculator.js`**：确定性计算引擎（非 AI）。

### 路由
- `/api/quotes`（`routes/quotes.js`）：CRUD + `/:id/calculate` + `/:id/analyze-drawing` + `/:id/ai-quote` + `/:id/ai-review` + `/:id/manual-review` + `/:id/export`(PDF) + `/:id/3d-model`。`GET /` 支持 `?materialCode=&partName=&partDescription=&q=&status=` 追溯过滤；**列表查询是瘦身投影**（`Quote.LIST_SELECT`：只取展示列 + `JSON_EXTRACT` 抽 calculation.total/blankSpec.MOQ/priceSnapshot.unitPrice，勿改回 `SELECT *`--drawingAnalysis 等 LONGTEXT JSON 列单行数百 KB，57 行实测 7MB+）。**无图纸下载端点**——详情页只展示 drawingPath 文件名，唯一文件下载是 PDF 报价单导出（`res.download` 仅用于 PDF）。
- `/api/catalog`（`routes/catalog.js`）：`GET materials`(含 active 价格+stale 标记)/`processes`/`strategies`；`POST materials/:id/prices`(确认单价，写历史)；`POST strategies`(新增成本策略，name 唯一校验)/`DELETE strategies/:id`(直接删，已有报价由 processSnapshot 快照保护)/`PUT strategies/:id`(改 name+7率+changeReason 审计)；`PUT processes/:id`(改工费率)。**已无 part-masters 路由**。
- `/api/upload`（`routes/upload.js`）：`POST /drawing`（multer 单文件上传）。
- `/api/assistant`（Dify 聊天代理，与报价无关）。
- `GET /health`：健康检查 + DeepSeek 配置状态。

### 报价状态机
`draft` -> `calculated` -> `ai_reviewed` -> `manually_reviewed` -> `finalized`；AI 报价路径 `ai_quoted`；`rejected`。每个端点写回对应 JSON 并推进 status。PDF 导出需 `manualReview.status === 'approved'`。

### CAD 解析链（`CADParserService.js`）
- 路由不直接调 CADParserService，而是经 `cadParserPool.js`（`cadParserWorker.js` worker 线程）：occt STEP 网格化是 CPU 密集同步操作，放 worker 避免阻塞事件循环；结果跨线程传 JSON 字符串（结构化克隆大数值数组极慢）；同文件（路径+大小+mtime）结果 LRU 缓存（6 条），重复分析毫秒级；服务启动时 `warmup()` 预载 occt WASM。
- DXF：`dxf-parser`；DWG：`dwgdxf`(WASM) 进程内转 DXF；STEP：`occt-import-js` 读三角网格，缓存 `uploads/models/{quoteId}.json`。三库均已是最新版且 license 可用（MIT/MIT/LGPL-2.1）。
- 2D 图纸产出参数化模型规格，前端 three.js 拉伸成 3D。AI 提取的尺寸（length/width/height/diameter）在第3步预填到 blankSpec/finishedSpec，**不直接参与成本计算**（成本主输入是毛重/净重/单价/工序）。
- **尺寸标注/公差提取**：`_extractDimensions` 从 DIMENSION 实体提取类型(线性/对齐/角度/直径/半径/坐标)、实测值、文本、位置、角度；公差优先从文本解析，回退到 DIMSTYLE 全局变量(`$DIMTP`/`$DIMTM`/`$DIMTOL`)。结果经 `analyze-drawing` 写入 `drawingAnalysis.dimensionAnnotations` + `globalTolerance`，并用于 `dimensions` 预填(直径/线性标注覆盖 bounds 估算)。
- **性能注意**：文件读取用 `fs.promises`(异步，勿用同步阻塞事件循环)；bounds 极值用单遍循环(勿用 `Math.min(...spread)`，大模型会栈溢出)；STEP 网格密度可由 env `STEP_LINEAR_DEFLECTION`(默认 0.005)/`STEP_ANGULAR_DEFLECTION`(默认 0.5) 调节。

### 上传文件存储
- multer 存储目录：`path.join(__dirname, '../uploads')`——因 `quotes.js`/`upload.js` 在 `backend/src/routes/` 下，`__dirname` 上跳一级后实际目录是 **`backend/src/uploads`**（不是 `backend/uploads`）。3D 模型缓存目录为 `backend/src/uploads/models`。
- `quotes.js` 与 `upload.js` 的 multer 存储规则一致（`backend/src/uploads/` + `{时间戳}-{随机数}{扩展名}`），改动两处同步。
- `backend/src/uploads/` 被 gitignored，不入库。

### 前端
路由（`App.js`）：`/` 与 `/quotes`（报价中心 `QuoteList.js`）、`/strategies`（成本策略管理 `Strategies.jsx`）、`/quotes/ai-new`（AI 工作台 `AIQuoteCreation.jsx`）、`/quotes/:id`（详情 `QuoteDetail.jsx`），右上角常驻 `AssistantChat` 组件。

AI 流程（`AIQuoteCreation.jsx`）5 步：
1. **上传图纸**（仅选文件，不填基础信息）
2. AI 解析图纸
3. **确认特征与成本参数**：左特征列表 / 中 3D 预览 + 参数修正（基本信息 + 材料规格 blankSpec + 产品规格 finishedSpec + 单价确认带市场价提醒）/ 右 **工序确认面板**（机加工填加工时长、损耗填率、阳极勾选、单制程成本填金额；填值即选中；实时汇总 R/S/T/U/V/W；工费率可内联「改」维护）。AI 提取尺寸预填规格。
4. 报价计算结果（K/R/S/T/U/V/W + 调机费）
5. AI 建议 + 交付

报价中心（`QuoteList.js`）：多字段追溯检索（物料编码/品名/物料描述/全部）+ 物料编码列点击追溯同码历史报价（侧抽屉）。

详情页 `/quotes/:id`（`QuoteDetail.jsx`）：按新计算结构展示明细 + 工序明细表 + 单价快照 + 计算方法（formulaTrace）。重算复用已存 `processSnapshot`。

API 集中在 `src/api/quotes.js`：`quoteApi`/`catalogApi`/`uploadApi`，因 CRA proxy 全用相对路径 `/api/...`。

## 易踩的坑

- **`db.query` 返回数组本身**，勿再 `const [rows]` 解构（见上）。
- **死代码文件**：`frontend/src/pages/QuoteDetail.js` 是旧版，`App.js` 实际导入 `QuoteDetail.jsx`，以 `.jsx` 为准。`AIQuoteCreation.jsx` 内 `LegacyAIQuoteCreation`（及其引用的 `AnalysisWorkbench`）是旧实现，**未渲染**，里面的 complexity 残留引用不影响线上。
- **混用扩展名**：新页面 `.jsx`（`AIQuoteCreation`、`QuoteDetail`、`Strategies`），旧页面 `.js`（`QuoteList`）。`App.js` import 显式带扩展名。
- **手动报价已移除**：原 `QuoteForm.js` 及 `/quotes/new` 路由已删除，改为 `/strategies`（成本策略管理 `Strategies.jsx`，对 pricing_strategies 做 CRUD）。新产品报价统一走 AI 工作台（`/quotes/ai-new`）1-5 步。
- **`rebuild-db` 会清空数据**；`seed` 幂等可重复执行（`seed.js` 现含 A/B 类无用列与整表清理，删过的列/表重复执行会跳过）。
- **gitignored**：`backend/src/uploads/`（上传文件 + 3D 模型缓存）不入库；MySQL 库 `quote` 需本机运行。
- **前端整页刷新 404**：`package.json` 的 `"proxy": "http://localhost:3001"` 会把 `/quotes/:id` 等 SPA 路由代理到后端（后端无此路由 -> 404）。页面内 React Router 导航正常，但直接刷新/直达 URL 会白屏。
- **`finalUnitPrice`/`strategyVersionId` 是 DECIMAL/BIGINT 独立列**，不是 JSON；空字符串需归一化为 null（`Quote.js` 的 `normalizeOptionalNumber`），否则 MySQL strict mode 报错。
