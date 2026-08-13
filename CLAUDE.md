# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

机加工 AI 智能报价系统：上传 CAD 图纸/图片 -> AI 分析 -> **确认材料/产品规格 + 工序 + 单价** -> 按《成本分析.xls》公式链计算报价 -> AI 预审/人工审核 -> 导出 PDF 报价单。前后端分离单仓库，后端 Node.js + Express + **MySQL**，前端 Create React App + React Router + three.js。

业务模型来源：`D:\Desktop\成本分析.xls` 与 `计算公式总结.md`（成本公式与工序目录的真相来源）。

## 常用命令

后端（在 `backend/` 目录）：
```bash
npm install
npm run dev          # nodemon 热重载，监听 src/，端口 3001
npm start            # 生产启动
npm run init-db      # 建表（ensureSchema，幂等）
npm run seed         # 种子数据修复（产品5样品倍率/阳极unitRate/S31603·S30408占位价，幂等）
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
`db.js` 用 `mysql2/promise` 连接池，`ensureSchema()` 建表。核心表：
- `quotes`：报价主表。嵌套对象（`calculation`/`aiReview`/`manualReview`/`drawingAnalysis`/`aiQuoteAnalysis`/`blankSpec`/`finishedSpec`/`priceSnapshot`/`processSnapshot`）存为 LONGTEXT JSON 列，`db.parseRow` 读取时反序列化。`materialCode`/`grossWeight`/`netWeight`/`strategyVersionId` 等为独立列。`id` 应用层生成。
- `materials` + `material_prices`：材料牌号（S31603/S30408…）与带生效日期的单价历史（`status=active/historical`，`confirmedAt` 标记是否市场确认）。
- `processes`：19 道工序目录，`costType` ∈ `time|percentage|weight|manual`，分别带 `hourlyRate`/`unitRate`/`fixedAmount`。
- `pricing_strategies`：报价策略（管销率/利润率/税率/样品倍率/材料损耗率/刀具损耗率/打样调机费）。按产品物码预置 5 条（`INVIC-35763000072/76/78/80/88`）。
- `part_masters`：零件主档（按物料编码存规格/工序路线/默认策略，供参考回填）。
- `quote_events`：报价事件流水（预留）。

⚠️ **`db.query()` 直接返回行数组**（内部已 `const [rows] = pool.query()` 并 `rows.map(parseRow)`）。调用方写 `const rows = await db.query(sql)`，**不要再解构** `const [rows]`（会取到首行对象）。`getConnection()` 拿到的原始 connection 才用 `[rows]` 解构。

### 自动迁移
`db.js` 的 `ensureSchema` 用 `INFORMATION_SCHEMA.COLUMNS` 检查缺失列并 `ALTER TABLE ADD COLUMN`。新增 quotes 字段需同步改：`db.js` ensureSchema 的 CREATE TABLE + `quoteColumns` 清单、`Quote` 模型的 `quoteFields`/`jsonFields`/create/update。

### 成本计算公式（`QuoteCalculator.js`，按计算公式总结.md）
确定性公式链，单输入单输出：
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
计算器签名：`QuoteCalculator.calculate(quote, { processSelection, strategy, unitPrice, setupFee })`。输出含 `materialCost/machiningCost/overhead/subtotal/profit/taxIncluded/samplePrice/setupFee/unitPrice/total` + `processes`/`additions` 明细 + `formulaTrace`（每步算式，供详情页/PDF 展示）。

### 三个「AI/规则」服务，勿混淆
- **`AIReviewer.js`**（`POST /:id/ai-review`）：纯规则引擎（总价区间、K/T 材料占比、R/T 机加工占比、单价缺失/过期提醒），不调外部 API。状态 `ai_reviewed`。
- **`DeepSeekService.js`**（`POST /:id/analyze-drawing`、`POST /:id/ai-quote`）：真 LLM 调用（`deepseek-chat` + `json_object`）。fallback 从 `processes` 表取真实工序（不再硬编码下料/粗加工/精加工）。
- **`QuoteCalculator.js`**：确定性计算引擎（非 AI）。

### 路由
- `/api/quotes`（`routes/quotes.js`）：CRUD + `/:id/calculate`（新：收 `processSelection/unitPrice/strategyId/strategyOverrides/setupFee`，写 `calculation/priceSnapshot/processSnapshot/strategyVersionId`）+ `/:id/analyze-drawing` + `/:id/ai-quote` + `/:id/ai-review` + `/:id/manual-review` + `/:id/export`(PDF) + `/:id/3d-model`。`GET /` 支持 `?materialCode=&partName=&partDescription=&q=&status=` 追溯过滤。
- `/api/catalog`（`routes/catalog.js`）：目录管理。`GET materials`(含 active 价格+stale 标记)/`processes`/`strategies`/`part-masters(/:materialCode)`；`POST materials/:id/prices`(确认单价，写历史)；`PUT processes/:id`(改工费率，需求5可维护)/`strategies/:id`。
- `/api/upload`、`/api/assistant`(Dify 聊天代理，与报价无关)。

### 报价状态机
`draft` -> `calculated` -> `ai_reviewed` -> `manually_reviewed` -> `finalized`；AI 报价路径 `ai_quoted`；`rejected`。每个端点写回对应 JSON 并推进 status。

### CAD 解析链（`CADParserService.js`）
- DXF：`dxf-parser`；DWG：`dwgdxf`(WASM) 进程内转 DXF（构造函数显式设 `wasmBase`，Windows 默认路径失效）；STEP：`occt-import-js` 读三角网格，缓存 `uploads/models/{quoteId}.json`。三库均已是最新版且 license 可用（MIT/MIT/LGPL-2.1），无需换库。
- 2D 图纸产出参数化模型规格，前端 three.js 拉伸成 3D。AI 提取的尺寸（length/width/height/diameter）在第3步预填到 blankSpec/finishedSpec，**不直接参与成本计算**（成本主输入是毛重/净重/单价/工序）。
- **尺寸标注/公差提取**：`_extractDimensions` 从 DIMENSION 实体提取类型(线性/对齐/角度/直径/半径/坐标)、实测值(actualMeasurement)、文本、位置、角度；公差优先从文本(`\S上^下;`/`±x`)解析，回退到 DIMSTYLE 全局变量(`$DIMTP`/`$DIMTM`/`$DIMTOL`)。结果经 `analyze-drawing` 写入 `analysisResult.dimensionAnnotations` + `globalTolerance`，并用于 `dimensions` 预填(直径/线性标注覆盖 bounds 估算)。
- **性能注意**：文件读取用 `fs.promises`(异步，勿用同步阻塞事件循环)；bounds 极值用单遍循环(勿用 `Math.min(...spread)`，大模型会栈溢出)；STEP 网格密度可由 env `STEP_LINEAR_DEFLECTION`(默认 0.005)/`STEP_ANGULAR_DEFLECTION`(默认 0.5) 调节，值越大三角面越少、解析与渲染越快。

### 前端
AI 流程（`/quotes/ai-new` -> `AIQuoteCreation.jsx`）5 步：
1. **上传图纸**（仅选文件，不填基础信息）
2. AI 解析图纸
3. **确认特征与成本参数**：左特征列表 / 中 3D 预览 + 参数修正（基本信息 + 材料规格 blankSpec + 产品规格 finishedSpec + 单价确认带市场价提醒）/ 右 **工序确认面板**（替换原任务摘要：机加工填加工时长、损耗填率、阳极勾选、固定填金额；填值即选中；实时汇总 R/S/T/U/V/W；工费率可内联「改」维护）。AI 提取尺寸预填规格。
4. 报价计算结果（新字段 K/R/S/T/U/V/W + 调机费）
5. AI 建议 + 交付

报价中心（`/quotes` -> `QuoteList.js`）：多字段追溯检索（物料编码/品名/物料描述/全部）+ 物料编码列点击追溯同码历史报价（侧抽屉）。产品级绑定字段（品名/物料描述）后期再定，当前三字段并存检索。

详情页 `/quotes/:id`（`QuoteDetail.jsx`）：按新计算结构展示明细 + 工序明细表 + 单价快照 + 计算方法（formulaTrace）。重算复用已存 `processSnapshot`。

API 集中在 `src/api/quotes.js`：`quoteApi`/`catalogApi`/`uploadApi`，因 CRA proxy 全用相对路径 `/api/...`。

## 易踩的坑

- **`db.query` 返回数组本身**，勿再 `const [rows]` 解构（见上）。
- **死代码文件**：`frontend/src/pages/QuoteDetail.js` 是旧版，`App.js` 实际导入 `QuoteDetail.jsx`，以 `.jsx` 为准。
- **混用扩展名**：新页面 `.jsx`（`AIQuoteCreation`、`QuoteDetail`），旧页面 `.js`（`QuoteForm`、`QuoteList`）。`App.js` import 显式带扩展名。
- **手动报价流程**（`QuoteForm.js`）未接入新工序确认，其「计算报价」无 processSelection 会得零值；主流是 AI 流程。`AIQuoteCreation.jsx` 内 `LegacyAIQuoteCreation` 是旧实现未渲染。
- **`rebuild-db` 会清空数据**；`seed` 幂等可重复执行。
- **gitignored**：`backend/uploads/`（上传文件 + 3D 模型缓存）不入库；MySQL 库 `quote` 需本机运行。
- `routes/quotes.js` 的 multer 与 `routes/upload.js` 存储规则一致（`uploads/` + 时间戳随机名），改动两处同步。
