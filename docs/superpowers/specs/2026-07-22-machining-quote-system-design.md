
# 机加工报价系统 - 设计文档

**日期**: 2026-07-22
**版本**: 1.0
**状态**: 设计中

## 1. 项目概述

### 1.1 目标
构建一个机加工报价系统，验证从图纸上传到报价单生成的完整流程，包括AI辅助审核和人工审核环节。

### 1.2 范围
- 零件参数输入（表单 + 图纸上传）
- 自动报价计算
- AI预审
- 人工审核
- 报价单生成与导出
- 历史报价查询

**不包含**: 用户认证、权限管理

## 2. 系统架构

### 2.1 技术栈
- **前端**: React
- **后端**: Node.js + Express
- **数据库**: SQLite 或 JSON文件存储
- **文件存储**: 本地文件系统

### 2.2 架构图
```
┌─────────────────────────────────┐
│         React 前端              │
│  - 表单输入                     │
│  - 图纸上传                     │
│  - 结果展示                     │
│  - 审核界面                     │
│  - 报价单导出                   │
└──────────────┬──────────────────┘
               │ HTTP/REST API
┌──────────────▼──────────────────┐
│      Node.js + Express 后端     │
│  - 图纸解析服务                 │
│  - 报价计算引擎                 │
│  - AI审核服务（规则引擎）       │
│  - 审核流程管理                 │
│  - 报价单生成                   │
└──────────────┬──────────────────┘
               │
┌──────────────▼──────────────────┐
│      数据存储                    │
│  - SQLite / JSON文件            │
│  - 本地文件存储（图纸）          │
└─────────────────────────────────┘
```

## 3. 核心功能模块

### 3.1 前端模块

#### 3.1.1 零件参数输入表单
- 零件名称、编号
- 材料类型（钢材、铝材、铜材等）
- 尺寸参数（长度、宽度、高度、直径等）
- 精度要求
- 数量
- 交货期

#### 3.1.2 图纸上传组件
- 支持常见CAD格式（DXF、STEP、IGES等）
- 或图片格式（PNG、JPG）
- 上传进度显示
- 预览功能

#### 3.1.3 报价计算结果展示
- 明细费用（材料、工时、设备、其他）
- 总价
- 计算依据说明

#### 3.1.4 AI审核结果查看
- AI预审意见
- 风险提示
- 建议调整项

#### 3.1.5 人工审核界面
- 查看报价详情
- 同意/拒绝/修改
- 添加审核意见
- 提交审核

#### 3.1.6 报价单生成与导出
- 报价单模板渲染
- 导出为PDF/Excel
- 打印功能

### 3.2 后端模块

#### 3.2.1 图纸解析服务（简化版）
- 提取图纸基本信息
- 识别尺寸标注
- 材料识别（如适用）

#### 3.2.2 报价计算引擎
**计算因素**:
- 材料成本
- 加工工时（车、铣、磨、钻等工序）
- 设备折旧
- 工艺复杂度
- 管理费用

**计算公式**:
```
总价 = 材料成本 + 各工序工时费 + 设备费 + 管理费 + 利润
```

#### 3.2.3 AI审核服务（规则引擎）
**审核规则**:
- 价格是否在合理区间
- 工时估算是否合理
- 材料选择是否匹配工艺
- 是否有遗漏工序
- 历史类似报价对比

#### 3.2.4 审核流程管理
- 状态管理（待审核、已通过、已拒绝、需修改）
- 审核记录保存

#### 3.2.5 报价单生成
- 模板渲染
- PDF/Excel导出

#### 3.2.6 历史数据管理
- 报价记录存储
- 查询和检索

## 4. 数据模型

### 4.1 报价记录 (Quote)
```javascript
{
  id: string,
  partName: string,
  partNumber: string,
  material: string,
  dimensions: {
    length: number,
    width: number,
    height: number,
    diameter?: number
  },
  quantity: number,
  deliveryDate: Date,
  precision: string,
  drawingPath?: string,
  calculation: {
    materialCost: number,
    laborCost: number,
    equipmentCost: number,
    overheadCost: number,
    profit: number,
    total: number,
    breakdown: Object
  },
  aiReview: {
    status: 'pass' | 'warning' | 'fail',
    comments: string[],
    suggestions: string[]
  },
  manualReview: {
    status: 'pending' | 'approved' | 'rejected' | 'needs_modification',
    reviewer: string,
    comments: string,
    reviewedAt: Date
  },
  status: 'draft' | 'calculated' | 'ai_reviewed' | 'manually_reviewed' | 'finalized',
  createdAt: Date,
  updatedAt: Date
}
```

### 4.2 报价模板 (QuoteTemplate)
```javascript
{
  id: string,
  name: string,
  fields: string[],
  layout: Object,
  isDefault: boolean
}
```

## 5. 工作流程

### 5.1 完整报价流程
```
1. 用户创建新报价
   ↓
2. 填写零件参数 + 上传图纸（可选）
   ↓
3. 系统解析图纸（如上传）
   ↓
4. 系统计算报价
   ↓
5. AI预审
   ↓
6. 人工审核
   ↓
7. 生成报价单
   ↓
8. 导出/打印
```

### 5.2 状态流转
```
draft → calculated → ai_reviewed → manually_reviewed → finalized
         ↓              ↓                ↓
         └──────────────┴────────────────┴─→ rejected
```

## 6. API 设计

### 6.1 报价相关
- `POST /api/quotes` - 创建新报价
- `GET /api/quotes` - 获取报价列表
- `GET /api/quotes/:id` - 获取报价详情
- `PUT /api/quotes/:id` - 更新报价
- `POST /api/quotes/:id/calculate` - 计算报价
- `POST /api/quotes/:id/ai-review` - 执行AI审核
- `POST /api/quotes/:id/manual-review` - 提交人工审核
- `GET /api/quotes/:id/export` - 导出生成报价单

### 6.2 文件上传
- `POST /api/upload/drawing` - 上传图纸

## 7. 实现计划

### 阶段1: 项目初始化
- 搭建React前端项目
- 搭建Node.js后端项目
- 配置开发环境

### 阶段2: 核心表单和数据结构
- 实现零件参数输入表单
- 实现数据存储
- 基础API

### 阶段3: 报价计算引擎
- 实现报价计算逻辑
- 前端结果展示

### 阶段4: 图纸上传
- 文件上传功能
- 简单的图纸解析/预览

### 阶段5: AI审核
- 实现规则引擎
- AI审核界面

### 阶段6: 人工审核流程
- 审核状态管理
- 审核界面

### 阶段7: 报价单生成
- 模板渲染
- PDF/Excel导出

### 阶段8: 历史查询
- 报价列表
- 详情查看

## 8. 成功标准

- 用户可以完整走完从创建报价到导出报价单的流程
- 报价计算逻辑正确，结果可解释
- AI审核能给出合理的预审意见
- 人工审核流程顺畅
- 界面友好，操作简单
