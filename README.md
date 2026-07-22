
# 机加工报价系统

一个用于机加工报价的Web应用系统，包含报价计算、AI审核、人工审核和报价单导出功能。

## 功能特性

- 报价创建与管理
- 自动报价计算（基于材料、工时、设备等）
- AI审核功能
- 人工审核流程
- PDF报价单导出
- 图纸上传功能

## 技术栈

- 前端: React, React Router, Axios
- 后端: Node.js, Express, SQLite
- 文件上传: Multer
- PDF生成: PDFKit

## 项目结构

```
ai-demo/
├── backend/
│   ├── src/
│   │   ├── models/
│   │   │   └── Quote.js          # 报价数据模型
│   │   ├── routes/
│   │   │   ├── quotes.js         # 报价API路由
│   │   │   └── upload.js         # 文件上传路由
│   │   ├── services/
│   │   │   ├── QuoteCalculator.js # 报价计算服务
│   │   │   ├── AIReviewer.js     # AI审核服务
│   │   │   └── QuoteGenerator.js # 报价单生成服务
│   │   ├── app.js                # Express应用
│   │   ├── server.js             # 服务器入口
│   │   ├── db.js                 # 数据库连接
│   │   └── init-db.js            # 数据库初始化
│   └── package.json
├── frontend/
│   ├── src/
│   │   ├── pages/
│   │   │   ├── QuoteForm.js      # 报价创建页面
│   │   │   ├── QuoteList.js      # 报价列表页面
│   │   │   └── QuoteDetail.js    # 报价详情页面
│   │   ├── api/
│   │   │   └── quotes.js         # API客户端
│   │   ├── App.js
│   │   └── index.js
│   └── package.json
├── docs/
│   └── superpowers/
│       ├── specs/                # 设计文档
│       └── plans/                # 实施计划
└── README.md
```

## 快速开始

### 后端设置

```bash
cd backend
npm install
npm run init-db
npm run dev
```

后端服务运行在 http://localhost:3001

### 前端设置

```bash
cd frontend
npm install
npm start
```

前端应用运行在 http://localhost:3000

## 使用流程

1. 创建新报价: 填写零件信息，可选择上传图纸
2. 计算报价: 系统自动计算各项费用
3. AI审核: 系统自动检查报价合理性
4. 人工审核: 人工确认或修改报价
5. 导出报价单: 生成PDF格式报价单

## 报价计算说明

报价包含以下部分：
- 材料成本: 基于体积、密度和材料价格
- 人工成本: 基于加工时间和精度要求
- 设备费用: 基于加工复杂度
- 管理费用: 总成本的15%
- 利润: 总成本的20%

## 状态说明

- 草稿: 刚创建，未计算
- 已计算: 报价已计算
- AI已审核: AI审核完成
- 人工已审核: 人工审核完成
- 已完成: 报价已最终确认

## 开发说明

本项目为演示项目，主要用于验证报价流程的可行性。所有功能均已实现，可直接运行测试。

