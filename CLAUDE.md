# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

机加工 AI 智能报价系统：上传 CAD 图纸/图片 → AI 分析提取参数 → 报价计算 → AI 预审/人工审核 → 导出 PDF 报价单。前后端分离的单仓库（monorepo），后端 Node.js + Express + SQLite，前端 Create React App + React Router + three.js。

## 常用命令

后端（在 `backend/` 目录）：
```bash
npm install
npm run dev          # nodemon 热重载，监听 src/，端口 3001
npm start            # 生产启动
npm run init-db      # 建表 + 自动迁移缺失列（非必需：服务启动时 db.js 会自动执行同样逻辑）
npm run rebuild-db   # ⚠️ 破坏性：删除整个 quotes.db 后重建，会清空所有报价数据
```

前端（在 `frontend/` 目录）：
```bash
npm install
npm start            # CRA 开发服务器，端口 3000，已配置 proxy 到 :3001
npm run build        # 生产构建到 build/
npm test             # CRA/Jest，但当前仓库没有任何测试文件
```

首次配置：`cp backend/.env.example backend/.env` 并填入 `DEEPSEEK_API_KEY`。无 Key 时 AI 功能会优雅降级到 fallback 结果，系统仍可运行。后端没有测试框架。

## 架构要点

### 数据存储：单表 + JSON 列
所有报价数据存在 SQLite 的单一 `quotes` 表中。嵌套对象（`calculation`、`aiReview`、`manualReview`、`drawingAnalysis`、`aiQuoteAnalysis`）以 JSON 字符串存于 TEXT 列。`models/Quote.js` 中 `_parseRow` 在读取时反序列化这些列，`update()` 在写入时把 object 序列化。Quote 的 `id` 是应用层生成（`Date.now().toString(36) + 随机串`），非数据库自增。

### 自动迁移机制
`db.js`（连接时）和 `init-db.js` 都会对比 `PRAGMA table_info(quotes)` 与一份「期望列」清单，对缺失列执行 `ALTER TABLE ADD COLUMN`。新增字段时需同步修改三处：`db.js` 与 `init-db.js` 的 CREATE TABLE + 期望列清单、`Quote` 模型的 create/update/`_parseRow`（若为 JSON 列）。

### 两个不同的「AI」服务，勿混淆
- **`AIReviewer.js`**（`POST /:id/ai-review`）：纯规则引擎，JS 硬编码的启发式判断（总价区间、材料成本占比等），**不调用任何外部 API**。状态置为 `ai_reviewed`。
- **`DeepSeekService.js`**（`POST /:id/analyze-drawing`、`POST /:id/ai-quote`）：真正调用 DeepSeek LLM。图纸图片走多模态视觉分析，报价走 chat 分析。均使用 `deepseek-chat` 模型 + `response_format: json_object`。未配置 Key 或调用失败时回退到 fallback。状态置为 `ai_quoted`。

### 报价状态机
`draft` → `calculated` → `ai_reviewed` → `manually_reviewed` → `finalized`；AI 报价路径产生 `ai_quoted`；`rejected` 亦可能。每个转换端点会把对应的 JSON 结果写回 quote 行。报价计算本身（`QuoteCalculator.js`）是确定性的：材料成本（按体积×密度×单价）+ 五道工序工时 + 管理费 15% + 利润 20%，价格/密度/精度系数均为硬编码常量表。

### CAD 解析链（`CADParserService.js`）
- **DXF**：`dxf-parser` 解析实体、边界、特征。
- **DWG**：`dwgdxf`（WebAssembly）在进程内转成 DXF 再解析，**无需安装 AutoCAD/ODA**。注意构造函数中显式将 `wasmBase` 指向已安装包的 `wasm/` 目录——默认路径在 Windows 下会失效。
- **STEP**：`occt-import-js` 读出三角网格。网格序列化后缓存为 `uploads/models/{quoteId}.json`，由 `GET /:id/3d-model` 提供给前端。
- 2D 图纸（DXF/DWG）会产出「参数化模型规格」（最大闭合轮廓 outline + 内部圆孔 holes），前端用 three.js 拉伸成 3D 并标注特征。

### 前端
两条创建流程：手动（`/quotes/new` → `QuoteForm`）和 AI（`/quotes/ai-new` → `AIQuoteCreation`，上传图纸 → analyze-drawing → ai-quote）。详情页 `/quotes/:id`。`AIQuoteCreation.jsx` 用 `@react-three/fiber` + `@react-three/drei` 渲染 3D 模型与特征标记。API 调用集中在 `src/api/quotes.js`，因 CRA proxy 配置全部用相对路径 `/api/...`。

## 易踩的坑

- **死代码文件**：`frontend/src/pages/QuoteDetail.js` 是旧版本，`App.js` 实际导入的是 `QuoteDetail.jsx`。改 `.js` 那份不会生效——以 `.jsx` 为准。
- **混用扩展名**：新页面是 `.jsx`（`AIQuoteCreation`、`QuoteDetail`），旧页面是 `.js`（`QuoteForm`、`QuoteList`）。`App.js` 中的 import 显式带了扩展名。
- **`rebuild-db` 会清空数据**。
- **gitignored 目录**：`backend/uploads/`（上传文件 + 3D 模型缓存）和 `backend/data/`（SQLite 库）不入库，本地生成。
- 后端 `routes/quotes.js` 中的 multer 与 `routes/upload.js` 使用相同的存储规则（`uploads/` 目录 + 时间戳随机文件名），改动时两处保持一致。
