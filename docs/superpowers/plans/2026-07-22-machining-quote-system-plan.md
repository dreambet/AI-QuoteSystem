
# 机加工报价系统 - 实施计划

&gt; **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 构建一个机加工报价系统，验证从图纸上传到报价单生成的完整流程。

**Architecture:** React前端 + Node.js/Express后端 + SQLite本地存储。采用模块化设计，各组件通过清晰的API接口通信。

**Tech Stack:** React 18, Node.js 20+, Express 4, SQLite3, Multer (文件上传), PDFKit (PDF生成)

---

## 全局约束

- 使用React函数组件 + Hooks
- 后端使用Express.js，RESTful API设计
- 数据存储使用SQLite或JSON文件（从简选择）
- 代码保持简洁，专注于核心流程验证

---

### 任务1: 项目初始化 - 后端项目搭建

**Files:**
- Create: `backend/package.json`
- Create: `backend/src/server.js`
- Create: `backend/src/app.js`

**Interfaces:**
- Produces: 基础Express服务器，监听端口3001

- [ ] **Step 1: 创建后端项目目录和package.json**

```bash
mkdir -p backend
cd backend
npm init -y
npm install express cors sqlite3 multer pdfkit
npm install --save-dev nodemon
```

- [ ] **Step 2: 创建后端入口文件 server.js**

```javascript
const app = require('./app');

const PORT = process.env.PORT || 3001;

app.listen(PORT, () =&gt; {
  console.log(`Server running on port ${PORT}`);
});
```

- [ ] **Step 3: 创建Express应用主文件 app.js**

```javascript
const express = require('express');
const cors = require('cors');

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.get('/health', (req, res) =&gt; {
  res.json({ status: 'ok' });
});

module.exports = app;
```

- [ ] **Step 4: 在package.json添加启动脚本**

```json
{
  "scripts": {
    "start": "node src/server.js",
    "dev": "nodemon src/server.js"
  }
}
```

- [ ] **Step 5: 测试启动后端**

```bash
cd backend
npm run dev
```
Expected: 控制台显示 "Server running on port 3001"

---

### 任务2: 项目初始化 - 前端项目搭建

**Files:**
- Create: `frontend/package.json`
- Create: `frontend/src/index.js`
- Create: `frontend/src/App.js`
- Create: `frontend/public/index.html`

**Interfaces:**
- Consumes: 后端API（任务1）
- Produces: React应用基础结构

- [ ] **Step 1: 创建前端项目目录**

```bash
mkdir -p frontend/src frontend/public
```

- [ ] **Step 2: 创建前端package.json**

```json
{
  "name": "machining-quote-frontend",
  "version": "1.0.0",
  "private": true,
  "dependencies": {
    "react": "^18.2.0",
    "react-dom": "^18.2.0",
    "react-router-dom": "^6.20.0",
    "react-scripts": "5.0.1",
    "axios": "^1.6.0"
  },
  "scripts": {
    "start": "react-scripts start",
    "build": "react-scripts build",
    "test": "react-scripts test",
    "eject": "react-scripts eject"
  },
  "browserslist": {
    "production": ["&gt;0.2%", "not dead", "not op_mini all"],
    "development": ["last 1 chrome version", "last 1 firefox version", "last 1 safari version"]
  },
  "proxy": "http://localhost:3001"
}
```

- [ ] **Step 3: 创建public/index.html**

```html
&lt;!DOCTYPE html&gt;
&lt;html lang="zh-CN"&gt;
  &lt;head&gt;
    &lt;meta charset="utf-8" /&gt;
    &lt;meta name="viewport" content="width=device-width, initial-scale=1" /&gt;
    &lt;title&gt;机加工报价系统&lt;/title&gt;
  &lt;/head&gt;
  &lt;body&gt;
    &lt;div id="root"&gt;&lt;/div&gt;
  &lt;/body&gt;
&lt;/html&gt;
```

- [ ] **Step 4: 创建src/index.js**

```javascript
import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App';

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  &lt;React.StrictMode&gt;
    &lt;App /&gt;
  &lt;/React.StrictMode&gt;
);
```

- [ ] **Step 5: 创建简单的src/App.js和index.css**

```javascript
import React from 'react';
import './App.css';

function App() {
  return (
    &lt;div className="App"&gt;
      &lt;header className="App-header"&gt;
        &lt;h1&gt;机加工报价系统&lt;/h1&gt;
      &lt;/header&gt;
    &lt;/div&gt;
  );
}

export default App;
```

```css
.App {
  text-align: center;
}

.App-header {
  background-color: #282c34;
  padding: 20px;
  color: white;
}
```

```css
body {
  margin: 0;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', sans-serif;
}
```

- [ ] **Step 6: 安装依赖并测试启动**

```bash
cd frontend
npm install
npm start
```
Expected: 浏览器自动打开，显示"机加工报价系统"

---

### 任务3: 后端 - 数据存储和报价模型

**Files:**
- Create: `backend/src/db.js`
- Create: `backend/src/models/Quote.js`
- Create: `backend/src/init-db.js`

**Interfaces:**
- Produces: Quote数据模型，CRUD操作接口

- [ ] **Step 1: 创建数据库连接模块 db.js**

```javascript
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, '../data/quotes.db');

const db = new sqlite3.Database(dbPath, (err) =&gt; {
  if (err) {
    console.error('Error opening database:', err.message);
  } else {
    console.log('Connected to SQLite database');
  }
});

module.exports = db;
```

- [ ] **Step 2: 创建数据库初始化脚本 init-db.js**

```javascript
const db = require('./db');
const fs = require('fs');
const path = require('path');

const dataDir = path.join(__dirname, '../data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const createTables = () =&gt; {
  db.serialize(() =&gt; {
    db.run(`
      CREATE TABLE IF NOT EXISTS quotes (
        id TEXT PRIMARY KEY,
        partName TEXT NOT NULL,
        partNumber TEXT,
        material TEXT NOT NULL,
        length REAL,
        width REAL,
        height REAL,
        diameter REAL,
        quantity INTEGER NOT NULL,
        deliveryDate TEXT,
        precision TEXT,
        drawingPath TEXT,
        calculation TEXT,
        aiReview TEXT,
        manualReview TEXT,
        status TEXT NOT NULL DEFAULT 'draft',
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL
      )
    `);
    console.log('Database tables created');
  });
};

createTables();
```

- [ ] **Step 3: 创建Quote模型 Quote.js**

```javascript
const db = require('../db');

class Quote {
  static create(data) {
    return new Promise((resolve, reject) =&gt; {
      const id = Date.now().toString(36) + Math.random().toString(36).substr(2);
      const now = new Date().toISOString();
      const {
        partName, partNumber, material, length, width, height, diameter,
        quantity, deliveryDate, precision
      } = data;

      const stmt = db.prepare(`
        INSERT INTO quotes (
          id, partName, partNumber, material, length, width, height, diameter,
          quantity, deliveryDate, precision, status, createdAt, updatedAt
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      stmt.run(
        id, partName, partNumber || '', material, length || 0, width || 0, height || 0, diameter || 0,
        quantity, deliveryDate || '', precision || '', 'draft', now, now,
        function(err) {
          if (err) reject(err);
          else resolve({ id, ...data, status: 'draft', createdAt: now, updatedAt: now });
        }
      );
    });
  }

  static findAll() {
    return new Promise((resolve, reject) =&gt; {
      db.all('SELECT * FROM quotes ORDER BY createdAt DESC', [], (err, rows) =&gt; {
        if (err) reject(err);
        else resolve(rows.map(row =&gt; Quote._parseRow(row)));
      });
    });
  }

  static findById(id) {
    return new Promise((resolve, reject) =&gt; {
      db.get('SELECT * FROM quotes WHERE id = ?', [id], (err, row) =&gt; {
        if (err) reject(err);
        else if (!row) resolve(null);
        else resolve(Quote._parseRow(row));
      });
    });
  }

  static update(id, data) {
    return new Promise((resolve, reject) =&gt; {
      const now = new Date().toISOString();
      const fields = [];
      const values = [];

      Object.keys(data).forEach(key =&gt; {
        if (key !== 'id' &amp;&amp; key !== 'createdAt') {
          fields.push(`${key} = ?`);
          values.push(typeof data[key] === 'object' ? JSON.stringify(data[key]) : data[key]);
        }
      });
      fields.push('updatedAt = ?');
      values.push(now);
      values.push(id);

      const stmt = db.prepare(`UPDATE quotes SET ${fields.join(', ')} WHERE id = ?`);
      stmt.run(values, function(err) {
        if (err) reject(err);
        else resolve(Quote.findById(id));
      });
    });
  }

  static _parseRow(row) {
    return {
      ...row,
      calculation: row.calculation ? JSON.parse(row.calculation) : null,
      aiReview: row.aiReview ? JSON.parse(row.aiReview) : null,
      manualReview: row.manualReview ? JSON.parse(row.manualReview) : null
    };
  }
}

module.exports = Quote;
```

- [ ] **Step 4: 更新package.json添加初始化脚本**

```json
{
  "scripts": {
    "init-db": "node src/init-db.js"
  }
}
```

- [ ] **Step 5: 初始化数据库**

```bash
cd backend
npm run init-db
```
Expected: 控制台显示 "Database tables created"

---

### 任务4: 后端 - 报价API路由

**Files:**
- Create: `backend/src/routes/quotes.js`
- Modify: `backend/src/app.js`

**Interfaces:**
- Consumes: Quote模型（任务3）
- Produces: RESTful API端点

- [ ] **Step 1: 创建报价路由 quotes.js**

```javascript
const express = require('express');
const router = express.Router();
const Quote = require('../models/Quote');

router.post('/', async (req, res) =&gt; {
  try {
    const quote = await Quote.create(req.body);
    res.status(201).json(quote);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/', async (req, res) =&gt; {
  try {
    const quotes = await Quote.findAll();
    res.json(quotes);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/:id', async (req, res) =&gt; {
  try {
    const quote = await Quote.findById(req.params.id);
    if (!quote) {
      return res.status(404).json({ error: 'Quote not found' });
    }
    res.json(quote);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.put('/:id', async (req, res) =&gt; {
  try {
    const quote = await Quote.update(req.params.id, req.body);
    res.json(quote);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
```

- [ ] **Step 2: 在app.js中注册路由**

```javascript
const quotesRouter = require('./routes/quotes');

app.use('/api/quotes', quotesRouter);
```

- [ ] **Step 3: 测试API**

```bash
curl -X POST http://localhost:3001/api/quotes \
  -H "Content-Type: application/json" \
  -d '{"partName":"测试零件","material":"钢材","quantity":10}'
```
Expected: 返回创建的报价JSON对象

---

### 任务5: 前端 - 报价创建表单页面

**Files:**
- Create: `frontend/src/pages/QuoteForm.js`
- Create: `frontend/src/api/quotes.js`
- Modify: `frontend/src/App.js`

**Interfaces:**
- Consumes: 后端API（任务4）
- Produces: 报价创建表单界面

- [ ] **Step 1: 创建API客户端 api/quotes.js**

```javascript
import axios from 'axios';

const API_BASE = '/api/quotes';

export const quoteApi = {
  create: (data) =&gt; axios.post(API_BASE, data),
  getAll: () =&gt; axios.get(API_BASE),
  getById: (id) =&gt; axios.get(`${API_BASE}/${id}`),
  update: (id, data) =&gt; axios.put(`${API_BASE}/${id}`, data)
};
```

- [ ] **Step 2: 创建报价表单组件 QuoteForm.js**

```javascript
import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { quoteApi } from '../api/quotes';

function QuoteForm() {
  const navigate = useNavigate();
  const [formData, setFormData] = useState({
    partName: '',
    partNumber: '',
    material: '钢材',
    length: '',
    width: '',
    height: '',
    diameter: '',
    quantity: 1,
    deliveryDate: '',
    precision: '中等'
  });

  const handleChange = (e) =&gt; {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const handleSubmit = async (e) =&gt; {
    e.preventDefault();
    try {
      const response = await quoteApi.create(formData);
      navigate(`/quotes/${response.data.id}`);
    } catch (error) {
      alert('创建失败: ' + error.message);
    }
  };

  return (
    &lt;div style={{ padding: '20px', maxWidth: '800px', margin: '0 auto' }}&gt;
      &lt;h2&gt;创建新报价&lt;/h2&gt;
      &lt;form onSubmit={handleSubmit}&gt;
        &lt;div style={{ marginBottom: '15px' }}&gt;
          &lt;label&gt;零件名称 *&lt;/label&gt;
          &lt;input
            type="text"
            name="partName"
            value={formData.partName}
            onChange={handleChange}
            required
            style={{ width: '100%', padding: '8px', marginTop: '5px' }}
          /&gt;
        &lt;/div&gt;

        &lt;div style={{ marginBottom: '15px' }}&gt;
          &lt;label&gt;零件编号&lt;/label&gt;
          &lt;input
            type="text"
            name="partNumber"
            value={formData.partNumber}
            onChange={handleChange}
            style={{ width: '100%', padding: '8px', marginTop: '5px' }}
          /&gt;
        &lt;/div&gt;

        &lt;div style={{ marginBottom: '15px' }}&gt;
          &lt;label&gt;材料 *&lt;/label&gt;
          &lt;select
            name="material"
            value={formData.material}
            onChange={handleChange}
            required
            style={{ width: '100%', padding: '8px', marginTop: '5px' }}
          &gt;
            &lt;option value="钢材"&gt;钢材&lt;/option&gt;
            &lt;option value="铝材"&gt;铝材&lt;/option&gt;
            &lt;option value="铜材"&gt;铜材&lt;/option&gt;
            &lt;option value="不锈钢"&gt;不锈钢&lt;/option&gt;
          &lt;/select&gt;
        &lt;/div&gt;

        &lt;div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '15px', marginBottom: '15px' }}&gt;
          &lt;div&gt;
            &lt;label&gt;长度 (mm)&lt;/label&gt;
            &lt;input
              type="number"
              name="length"
              value={formData.length}
              onChange={handleChange}
              style={{ width: '100%', padding: '8px', marginTop: '5px' }}
            /&gt;
          &lt;/div&gt;
          &lt;div&gt;
            &lt;label&gt;宽度 (mm)&lt;/label&gt;
            &lt;input
              type="number"
              name="width"
              value={formData.width}
              onChange={handleChange}
              style={{ width: '100%', padding: '8px', marginTop: '5px' }}
            /&gt;
          &lt;/div&gt;
        &lt;/div&gt;

        &lt;div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '15px', marginBottom: '15px' }}&gt;
          &lt;div&gt;
            &lt;label&gt;高度 (mm)&lt;/label&gt;
            &lt;input
              type="number"
              name="height"
              value={formData.height}
              onChange={handleChange}
              style={{ width: '100%', padding: '8px', marginTop: '5px' }}
            /&gt;
          &lt;/div&gt;
          &lt;div&gt;
            &lt;label&gt;直径 (mm)&lt;/label&gt;
            &lt;input
              type="number"
              name="diameter"
              value={formData.diameter}
              onChange={handleChange}
              style={{ width: '100%', padding: '8px', marginTop: '5px' }}
            /&gt;
          &lt;/div&gt;
        &lt;/div&gt;

        &lt;div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '15px', marginBottom: '15px' }}&gt;
          &lt;div&gt;
            &lt;label&gt;数量 *&lt;/label&gt;
            &lt;input
              type="number"
              name="quantity"
              value={formData.quantity}
              onChange={handleChange}
              min="1"
              required
              style={{ width: '100%', padding: '8px', marginTop: '5px' }}
            /&gt;
          &lt;/div&gt;
          &lt;div&gt;
            &lt;label&gt;交货期&lt;/label&gt;
            &lt;input
              type="date"
              name="deliveryDate"
              value={formData.deliveryDate}
              onChange={handleChange}
              style={{ width: '100%', padding: '8px', marginTop: '5px' }}
            /&gt;
          &lt;/div&gt;
        &lt;/div&gt;

        &lt;div style={{ marginBottom: '20px' }}&gt;
          &lt;label&gt;精度要求&lt;/label&gt;
          &lt;select
            name="precision"
            value={formData.precision}
            onChange={handleChange}
            style={{ width: '100%', padding: '8px', marginTop: '5px' }}
          &gt;
            &lt;option value="低"&gt;低&lt;/option&gt;
            &lt;option value="中等"&gt;中等&lt;/option&gt;
            &lt;option value="高"&gt;高&lt;/option&gt;
            &lt;option value="极高"&gt;极高&lt;/option&gt;
          &lt;/select&gt;
        &lt;/div&gt;

        &lt;button
          type="submit"
          style={{
            padding: '12px 24px',
            backgroundColor: '#007bff',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer'
          }}
        &gt;
          创建报价
        &lt;/button&gt;
      &lt;/form&gt;
    &lt;/div&gt;
  );
}

export default QuoteForm;
```

- [ ] **Step 3: 更新App.js添加路由**

```javascript
import React from 'react';
import { BrowserRouter as Router, Routes, Route, Link } from 'react-router-dom';
import QuoteForm from './pages/QuoteForm';
import './App.css';

function App() {
  return (
    &lt;Router&gt;
      &lt;div className="App"&gt;
        &lt;header className="App-header"&gt;
          &lt;h1&gt;机加工报价系统&lt;/h1&gt;
          &lt;nav style={{ marginTop: '10px' }}&gt;
            &lt;Link to="/" style={{ color: 'white', marginRight: '20px' }}&gt;首页&lt;/Link&gt;
            &lt;Link to="/quotes/new" style={{ color: 'white' }}&gt;新建报价&lt;/Link&gt;
          &lt;/nav&gt;
        &lt;/header&gt;
        &lt;main&gt;
          &lt;Routes&gt;
            &lt;Route path="/" element={&lt;div&gt;&lt;h2&gt;欢迎使用机加工报价系统&lt;/h2&gt;&lt;/div&gt;} /&gt;
            &lt;Route path="/quotes/new" element={&lt;QuoteForm /&gt;} /&gt;
          &lt;/Routes&gt;
        &lt;/main&gt;
      &lt;/div&gt;
    &lt;/Router&gt;
  );
}

export default App;
```

- [ ] **Step 4: 测试表单**

启动前后端，访问 http://localhost:3000/quotes/new，填写表单并提交
Expected: 成功创建报价并跳转

---

### 任务6: 后端 - 报价计算引擎

**Files:**
- Create: `backend/src/services/QuoteCalculator.js`
- Modify: `backend/src/routes/quotes.js`

**Interfaces:**
- Consumes: Quote模型
- Produces: 报价计算服务，/api/quotes/:id/calculate端点

- [ ] **Step 1: 创建报价计算服务 QuoteCalculator.js**

```javascript
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
    if (diameter &amp;&amp; diameter &gt; 0) {
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
```

- [ ] **Step 2: 在quotes.js中添加计算端点**

```javascript
const QuoteCalculator = require('../services/QuoteCalculator');

router.post('/:id/calculate', async (req, res) =&gt; {
  try {
    const quote = await Quote.findById(req.params.id);
    if (!quote) {
      return res.status(404).json({ error: 'Quote not found' });
    }

    const calculation = QuoteCalculator.calculate(quote);
    const updatedQuote = await Quote.update(req.params.id, {
      calculation,
      status: 'calculated'
    });

    res.json(updatedQuote);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
```

- [ ] **Step 3: 测试报价计算**

```bash
curl -X POST http://localhost:3001/api/quotes/&lt;报价ID&gt;/calculate
```
Expected: 返回包含calculation字段的报价对象

---

### 任务7: 后端 - AI审核服务

**Files:**
- Create: `backend/src/services/AIReviewer.js`
- Modify: `backend/src/routes/quotes.js`

**Interfaces:**
- Consumes: 报价计算结果
- Produces: AI审核服务，/api/quotes/:id/ai-review端点

- [ ] **Step 1: 创建AI审核服务 AIReviewer.js**

```javascript
class AIReviewer {
  static review(quote) {
    const { calculation, material, quantity } = quote;
    const comments = [];
    const suggestions = [];
    let status = 'pass';

    if (!calculation) {
      return { status: 'fail', comments: ['请先计算报价'], suggestions: [] };
    }

    if (calculation.total &lt; 100) {
      comments.push('报价偏低，建议检查计算');
      status = 'warning';
    }

    if (calculation.total &gt; 100000) {
      comments.push('报价较高，建议双人复核');
      status = 'warning';
    }

    if (calculation.materialCost / calculation.total &gt; 0.6) {
      suggestions.push('材料成本占比过高，考虑优化用料');
    }

    if (quantity &gt; 100) {
      suggestions.push('大批量订单，建议给与批量折扣');
    }

    if (['不锈钢', '铜材'].includes(material)) {
      suggestions.push('贵重材料，建议确认材料价格最新行情');
    }

    if (comments.length === 0 &amp;&amp; status === 'pass') {
      comments.push('AI预审通过，报价基本合理');
    }

    return { status, comments, suggestions };
  }
}

module.exports = AIReviewer;
```

- [ ] **Step 2: 在quotes.js中添加AI审核端点**

```javascript
const AIReviewer = require('../services/AIReviewer');

router.post('/:id/ai-review', async (req, res) =&gt; {
  try {
    const quote = await Quote.findById(req.params.id);
    if (!quote) {
      return res.status(404).json({ error: 'Quote not found' });
    }

    const aiReview = AIReviewer.review(quote);
    const updatedQuote = await Quote.update(req.params.id, {
      aiReview,
      status: 'ai_reviewed'
    });

    res.json(updatedQuote);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
```

- [ ] **Step 3: 测试AI审核**

```bash
curl -X POST http://localhost:3001/api/quotes/&lt;报价ID&gt;/ai-review
```
Expected: 返回包含aiReview字段的报价对象

---

### 任务8: 后端 - 人工审核和报价单生成

**Files:**
- Create: `backend/src/services/QuoteGenerator.js`
- Modify: `backend/src/routes/quotes.js`

**Interfaces:**
- Consumes: Quote模型
- Produces: 人工审核端点和报价单导出端点

- [ ] **Step 1: 创建报价单生成服务 QuoteGenerator.js**

```javascript
const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');

class QuoteGenerator {
  static generatePDF(quote, outputPath) {
    return new Promise((resolve, reject) =&gt; {
      const doc = new PDFDocument();
      const stream = fs.createWriteStream(outputPath);
      doc.pipe(stream);

      doc.fontSize(20).text('机加工报价单', { align: 'center' });
      doc.moveDown();

      doc.fontSize(14).text(`报价单号: ${quote.id}`);
      doc.text(`零件名称: ${quote.partName}`);
      doc.text(`零件编号: ${quote.partNumber || '-'}`);
      doc.text(`材料: ${quote.material}`);
      doc.moveDown();

      if (quote.calculation) {
        doc.fontSize(16).text('报价明细', { underline: true });
        doc.moveDown();
        doc.fontSize(12);
        doc.text(`材料成本: ¥${quote.calculation.materialCost.toFixed(2)}`);
        doc.text(`人工成本: ¥${quote.calculation.laborCost.toFixed(2)}`);
        doc.text(`设备费用: ¥${quote.calculation.equipmentCost.toFixed(2)}`);
        doc.text(`管理费用: ¥${quote.calculation.overheadCost.toFixed(2)}`);
        doc.text(`利润: ¥${quote.calculation.profit.toFixed(2)}`);
        doc.moveDown();
        doc.fontSize(16).text(`总计: ¥${quote.calculation.total.toFixed(2)}`, { align: 'right' });
      }

      if (quote.aiReview) {
        doc.moveDown();
        doc.fontSize(14).text('AI审核意见', { underline: true });
        doc.moveDown();
        doc.fontSize(12);
        doc.text(`状态: ${quote.aiReview.status === 'pass' ? '通过' : quote.aiReview.status === 'warning' ? '警告' : '不通过'}`);
        if (quote.aiReview.comments.length &gt; 0) {
          doc.text('意见:');
          quote.aiReview.comments.forEach(comment =&gt; {
            doc.text(`  - ${comment}`);
          });
        }
      }

      if (quote.manualReview) {
        doc.moveDown();
        doc.fontSize(14).text('人工审核', { underline: true });
        doc.moveDown();
        doc.fontSize(12);
        doc.text(`状态: ${quote.manualReview.status === 'approved' ? '已通过' : quote.manualReview.status === 'rejected' ? '已拒绝' : '需修改'}`);
        doc.text(`审核意见: ${quote.manualReview.comments || '-'}`);
      }

      doc.moveDown(2);
      doc.fontSize(10).text(`生成时间: ${new Date().toLocaleString('zh-CN')}`, { align: 'center' });

      doc.end();
      stream.on('finish', () =&gt; resolve(outputPath));
      stream.on('error', reject);
    });
  }
}

module.exports = QuoteGenerator;
```

- [ ] **Step 2: 在quotes.js中添加入工审核和导出端点**

```javascript
const QuoteGenerator = require('../services/QuoteGenerator');
const path = require('path');
const fs = require('fs');

const uploadsDir = path.join(__dirname, '../uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

router.post('/:id/manual-review', async (req, res) =&gt; {
  try {
    const { status, comments } = req.body;
    const manualReview = {
      status,
      comments,
      reviewedAt: new Date().toISOString()
    };

    const updatedQuote = await Quote.update(req.params.id, {
      manualReview,
      status: status === 'approved' ? 'finalized' : 'manually_reviewed'
    });

    res.json(updatedQuote);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/:id/export', async (req, res) =&gt; {
  try {
    const quote = await Quote.findById(req.params.id);
    if (!quote) {
      return res.status(404).json({ error: 'Quote not found' });
    }

    const outputPath = path.join(uploadsDir, `quote-${quote.id}.pdf`);
    await QuoteGenerator.generatePDF(quote, outputPath);

    res.download(outputPath, `报价单-${quote.partName}.pdf`);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
```

---

### 任务9: 前端 - 报价详情页面

**Files:**
- Create: `frontend/src/pages/QuoteDetail.js`
- Create: `frontend/src/pages/QuoteList.js`
- Modify: `frontend/src/App.js`
- Modify: `frontend/src/api/quotes.js`

**Interfaces:**
- Consumes: 后端API（任务4,6,7,8）
- Produces: 报价详情、列表页面

- [ ] **Step 1: 更新api/quotes.js添加新方法**

```javascript
export const quoteApi = {
  create: (data) =&gt; axios.post(API_BASE, data),
  getAll: () =&gt; axios.get(API_BASE),
  getById: (id) =&gt; axios.get(`${API_BASE}/${id}`),
  update: (id, data) =&gt; axios.put(`${API_BASE}/${id}`, data),
  calculate: (id) =&gt; axios.post(`${API_BASE}/${id}/calculate`),
  aiReview: (id) =&gt; axios.post(`${API_BASE}/${id}/ai-review`),
  manualReview: (id, data) =&gt; axios.post(`${API_BASE}/${id}/manual-review`, data),
  export: (id) =&gt; window.open(`${API_BASE}/${id}/export`)
};
```

- [ ] **Step 2: 创建报价列表页面 QuoteList.js**

```javascript
import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { quoteApi } from '../api/quotes';

function QuoteList() {
  const [quotes, setQuotes] = useState([]);

  useEffect(() =&gt; {
    loadQuotes();
  }, []);

  const loadQuotes = async () =&gt; {
    const response = await quoteApi.getAll();
    setQuotes(response.data);
  };

  const getStatusText = (status) =&gt; {
    const map = {
      'draft': '草稿',
      'calculated': '已计算',
      'ai_reviewed': 'AI已审核',
      'manually_reviewed': '人工已审核',
      'finalized': '已完成'
    };
    return map[status] || status;
  };

  return (
    &lt;div style={{ padding: '20px', maxWidth: '1000px', margin: '0 auto' }}&gt;
      &lt;div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}&gt;
        &lt;h2&gt;报价列表&lt;/h2&gt;
        &lt;Link
          to="/quotes/new"
          style={{
            padding: '10px 20px',
            backgroundColor: '#007bff',
            color: 'white',
            textDecoration: 'none',
            borderRadius: '4px'
          }}
        &gt;
          + 新建报价
        &lt;/Link&gt;
      &lt;/div&gt;

      &lt;table style={{ width: '100%', borderCollapse: 'collapse' }}&gt;
        &lt;thead&gt;
          &lt;tr style={{ backgroundColor: '#f5f5f5' }}&gt;
            &lt;th style={{ padding: '12px', textAlign: 'left', borderBottom: '1px solid #ddd' }}&gt;零件名称&lt;/th&gt;
            &lt;th style={{ padding: '12px', textAlign: 'left', borderBottom: '1px solid #ddd' }}&gt;材料&lt;/th&gt;
            &lt;th style={{ padding: '12px', textAlign: 'left', borderBottom: '1px solid #ddd' }}&gt;数量&lt;/th&gt;
            &lt;th style={{ padding: '12px', textAlign: 'left', borderBottom: '1px solid #ddd' }}&gt;总价&lt;/th&gt;
            &lt;th style={{ padding: '12px', textAlign: 'left', borderBottom: '1px solid #ddd' }}&gt;状态&lt;/th&gt;
            &lt;th style={{ padding: '12px', textAlign: 'left', borderBottom: '1px solid #ddd' }}&gt;操作&lt;/th&gt;
          &lt;/tr&gt;
        &lt;/thead&gt;
        &lt;tbody&gt;
          {quotes.map(quote =&gt; (
            &lt;tr key={quote.id}&gt;
              &lt;td style={{ padding: '12px', borderBottom: '1px solid #ddd' }}&gt;{quote.partName}&lt;/td&gt;
              &lt;td style={{ padding: '12px', borderBottom: '1px solid #ddd' }}&gt;{quote.material}&lt;/td&gt;
              &lt;td style={{ padding: '12px', borderBottom: '1px solid #ddd' }}&gt;{quote.quantity}&lt;/td&gt;
              &lt;td style={{ padding: '12px', borderBottom: '1px solid #ddd' }}&gt;
                {quote.calculation ? `¥${quote.calculation.total.toFixed(2)}` : '-'}
              &lt;/td&gt;
              &lt;td style={{ padding: '12px', borderBottom: '1px solid #ddd' }}&gt;{getStatusText(quote.status)}&lt;/td&gt;
              &lt;td style={{ padding: '12px', borderBottom: '1px solid #ddd' }}&gt;
                &lt;Link to={`/quotes/${quote.id}`}&gt;查看&lt;/Link&gt;
              &lt;/td&gt;
            &lt;/tr&gt;
          ))}
        &lt;/tbody&gt;
      &lt;/table&gt;
    &lt;/div&gt;
  );
}

export default QuoteList;
```

- [ ] **Step 3: 创建报价详情页面 QuoteDetail.js**

```javascript
import React, { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { quoteApi } from '../api/quotes';

function QuoteDetail() {
  const { id } = useParams();
  const [quote, setQuote] = useState(null);
  const [reviewData, setReviewData] = useState({ status: 'approved', comments: '' });

  useEffect(() =&gt; {
    loadQuote();
  }, [id]);

  const loadQuote = async () =&gt; {
    const response = await quoteApi.getById(id);
    setQuote(response.data);
  };

  const handleCalculate = async () =&gt; {
    const response = await quoteApi.calculate(id);
    setQuote(response.data);
  };

  const handleAIReview = async () =&gt; {
    const response = await quoteApi.aiReview(id);
    setQuote(response.data);
  };

  const handleManualReview = async () =&gt; {
    const response = await quoteApi.manualReview(id, reviewData);
    setQuote(response.data);
  };

  const handleExport = () =&gt; {
    quoteApi.export(id);
  };

  if (!quote) return &lt;div&gt;加载中...&lt;/div&gt;;

  return (
    &lt;div style={{ padding: '20px', maxWidth: '1000px', margin: '0 auto' }}&gt;
      &lt;div style={{ marginBottom: '20px' }}&gt;
        &lt;Link to="/quotes"&gt;← 返回列表&lt;/Link&gt;
      &lt;/div&gt;

      &lt;h2&gt;报价详情 - {quote.partName}&lt;/h2&gt;

      &lt;div style={{ backgroundColor: '#f5f5f5', padding: '20px', marginBottom: '20px', borderRadius: '4px' }}&gt;
        &lt;h3&gt;基本信息&lt;/h3&gt;
        &lt;p&gt;&lt;strong&gt;零件编号:&lt;/strong&gt; {quote.partNumber || '-'}&lt;/p&gt;
        &lt;p&gt;&lt;strong&gt;材料:&lt;/strong&gt; {quote.material}&lt;/p&gt;
        &lt;p&gt;&lt;strong&gt;尺寸:&lt;/strong&gt; {quote.length || '-'} x {quote.width || '-'} x {quote.height || '-'} mm&lt;/p&gt;
        &lt;p&gt;&lt;strong&gt;数量:&lt;/strong&gt; {quote.quantity}&lt;/p&gt;
        &lt;p&gt;&lt;strong&gt;精度:&lt;/strong&gt; {quote.precision}&lt;/p&gt;
        &lt;p&gt;&lt;strong&gt;状态:&lt;/strong&gt; {quote.status}&lt;/p&gt;
      &lt;/div&gt;

      {quote.calculation ? (
        &lt;div style={{ backgroundColor: '#e8f5e9', padding: '20px', marginBottom: '20px', borderRadius: '4px' }}&gt;
          &lt;h3&gt;报价明细&lt;/h3&gt;
          &lt;p&gt;材料成本: ¥{quote.calculation.materialCost.toFixed(2)}&lt;/p&gt;
          &lt;p&gt;人工成本: ¥{quote.calculation.laborCost.toFixed(2)}&lt;/p&gt;
          &lt;p&gt;设备费用: ¥{quote.calculation.equipmentCost.toFixed(2)}&lt;/p&gt;
          &lt;p&gt;管理费用: ¥{quote.calculation.overheadCost.toFixed(2)}&lt;/p&gt;
          &lt;p&gt;利润: ¥{quote.calculation.profit.toFixed(2)}&lt;/p&gt;
          &lt;hr /&gt;
          &lt;p style={{ fontSize: '18px', fontWeight: 'bold' }}&gt;总价: ¥{quote.calculation.total.toFixed(2)}&lt;/p&gt;
        &lt;/div&gt;
      ) : (
        &lt;div style={{ marginBottom: '20px' }}&gt;
          &lt;button onClick={handleCalculate} style={buttonStyle}&gt;
            计算报价
          &lt;/button&gt;
        &lt;/div&gt;
      )}

      {quote.aiReview &amp;&amp; (
        &lt;div style={{ backgroundColor: '#fff3e0', padding: '20px', marginBottom: '20px', borderRadius: '4px' }}&gt;
          &lt;h3&gt;AI审核结果&lt;/h3&gt;
          &lt;p&gt;&lt;strong&gt;状态:&lt;/strong&gt; {quote.aiReview.status}&lt;/p&gt;
          &lt;p&gt;&lt;strong&gt;意见:&lt;/strong&gt;&lt;/p&gt;
          &lt;ul&gt;
            {quote.aiReview.comments.map((c, i) =&gt; &lt;li key={i}&gt;{c}&lt;/li&gt;)}
          &lt;/ul&gt;
          {quote.aiReview.suggestions.length &gt; 0 &amp;&amp; (
            &lt;&gt;
              &lt;p&gt;&lt;strong&gt;建议:&lt;/strong&gt;&lt;/p&gt;
              &lt;ul&gt;
                {quote.aiReview.suggestions.map((s, i) =&gt; &lt;li key={i}&gt;{s}&lt;/li&gt;)}
              &lt;/ul&gt;
            &lt;/&gt;
          )}
        &lt;/div&gt;
      )}

      {quote.calculation &amp;&amp; !quote.aiReview &amp;&amp; (
        &lt;div style={{ marginBottom: '20px' }}&gt;
          &lt;button onClick={handleAIReview} style={{ ...buttonStyle, backgroundColor: '#ff9800' }}&gt;
            执行AI审核
          &lt;/button&gt;
        &lt;/div&gt;
      )}

      {quote.aiReview &amp;&amp; !quote.manualReview &amp;&amp; (
        &lt;div style={{ backgroundColor: '#e3f2fd', padding: '20px', marginBottom: '20px', borderRadius: '4px' }}&gt;
          &lt;h3&gt;人工审核&lt;/h3&gt;
          &lt;div style={{ marginBottom: '10px' }}&gt;
            &lt;label&gt;审核结果:&lt;/label&gt;
            &lt;select
              value={reviewData.status}
              onChange={(e) =&gt; setReviewData({ ...reviewData, status: e.target.value })}
              style={{ marginLeft: '10px', padding: '5px' }}
            &gt;
              &lt;option value="approved"&gt;通过&lt;/option&gt;
              &lt;option value="rejected"&gt;拒绝&lt;/option&gt;
              &lt;option value="needs_modification"&gt;需修改&lt;/option&gt;
            &lt;/select&gt;
          &lt;/div&gt;
          &lt;div style={{ marginBottom: '10px' }}&gt;
            &lt;label&gt;审核意见:&lt;/label&gt;
            &lt;textarea
              value={reviewData.comments}
              onChange={(e) =&gt; setReviewData({ ...reviewData, comments: e.target.value })}
              style={{ width: '100%', height: '80px', marginTop: '5px', padding: '8px' }}
            /&gt;
          &lt;/div&gt;
          &lt;button onClick={handleManualReview} style={{ ...buttonStyle, backgroundColor: '#4caf50' }}&gt;
            提交审核
          &lt;/button&gt;
        &lt;/div&gt;
      )}

      {quote.manualReview &amp;&amp; (
        &lt;div style={{ backgroundColor: '#e8f5e9', padding: '20px', marginBottom: '20px', borderRadius: '4px' }}&gt;
          &lt;h3&gt;人工审核&lt;/h3&gt;
          &lt;p&gt;&lt;strong&gt;状态:&lt;/strong&gt; {quote.manualReview.status}&lt;/p&gt;
          &lt;p&gt;&lt;strong&gt;意见:&lt;/strong&gt; {quote.manualReview.comments || '-'}&lt;/p&gt;
        &lt;/div&gt;
      )}

      {quote.manualReview &amp;&amp; quote.manualReview.status === 'approved' &amp;&amp; (
        &lt;div&gt;
          &lt;button onClick={handleExport} style={{ ...buttonStyle, backgroundColor: '#9c27b0' }}&gt;
            导出报价单 (PDF)
          &lt;/button&gt;
        &lt;/div&gt;
      )}
    &lt;/div&gt;
  );
}

const buttonStyle = {
  padding: '12px 24px',
  backgroundColor: '#007bff',
  color: 'white',
  border: 'none',
  borderRadius: '4px',
  cursor: 'pointer',
  fontSize: '16px'
};

export default QuoteDetail;
```

- [ ] **Step 4: 更新App.js路由**

```javascript
import QuoteList from './pages/QuoteList';
import QuoteDetail from './pages/QuoteDetail';

&lt;Routes&gt;
  &lt;Route path="/" element={&lt;QuoteList /&gt;} /&gt;
  &lt;Route path="/quotes" element={&lt;QuoteList /&gt;} /&gt;
  &lt;Route path="/quotes/new" element={&lt;QuoteForm /&gt;} /&gt;
  &lt;Route path="/quotes/:id" element={&lt;QuoteDetail /&gt;} /&gt;
&lt;/Routes&gt;
```

---

### 任务10: 前端 - 图纸上传功能

**Files:**
- Create: `backend/src/routes/upload.js`
- Modify: `backend/src/app.js`
- Modify: `frontend/src/pages/QuoteForm.js`
- Modify: `frontend/src/api/quotes.js`

**Interfaces:**
- Consumes: Multer文件上传
- Produces: 图纸上传功能

- [ ] **Step 1: 创建上传路由 upload.js**

```javascript
const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const uploadsDir = path.join(__dirname, '../uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) =&gt; {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) =&gt; {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({ storage });

router.post('/drawing', upload.single('drawing'), (req, res) =&gt; {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  res.json({
    filename: req.file.filename,
    originalName: req.file.originalname,
    path: req.file.path,
    size: req.file.size
  });
});

module.exports = router;
```

- [ ] **Step 2: 在app.js中注册上传路由**

```javascript
const uploadRouter = require('./routes/upload');

app.use('/api/upload', uploadRouter);
```

- [ ] **Step 3: 更新前端api/quotes.js添加上传方法**

```javascript
export const uploadApi = {
  uploadDrawing: (file) =&gt; {
    const formData = new FormData();
    formData.append('drawing', file);
    return axios.post('/api/upload/drawing', formData, {
      headers: { 'Content-Type': 'multipart/form-data' }
    });
  }
};
```

- [ ] **Step 4: 更新QuoteForm.js添加上传功能**

```javascript
import { quoteApi, uploadApi } from '../api/quotes';

function QuoteForm() {
  const [formData, setFormData] = useState({...});
  const [selectedFile, setSelectedFile] = useState(null);
  const [uploadedPath, setUploadedPath] = useState(null);

  const handleFileChange = (e) =&gt; {
    setSelectedFile(e.target.files[0]);
  };

  const handleFileUpload = async () =&gt; {
    if (!selectedFile) return;
    try {
      const response = await uploadApi.uploadDrawing(selectedFile);
      setUploadedPath(response.data.filename);
      alert('上传成功!');
    } catch (error) {
      alert('上传失败: ' + error.message);
    }
  };

  const handleSubmit = async (e) =&gt; {
    e.preventDefault();
    try {
      const data = { ...formData, drawingPath: uploadedPath };
      const response = await quoteApi.create(data);
      navigate(`/quotes/${response.data.id}`);
    } catch (error) {
      alert('创建失败: ' + error.message);
    }
  };

  return (
    &lt;div ...&gt;
      {/* ... 原有表单字段 ... */}

      &lt;div style={{ marginBottom: '20px' }}&gt;
        &lt;label&gt;图纸上传&lt;/label&gt;
        &lt;div style={{ marginTop: '10px' }}&gt;
          &lt;input type="file" onChange={handleFileChange} accept=".pdf,.png,.jpg,.jpeg,.dxf" /&gt;
          {selectedFile &amp;&amp; (
            &lt;button onClick={handleFileUpload} style={{ marginLeft: '10px', padding: '8px 16px' }}&gt;
              上传
            &lt;/button&gt;
          )}
          {uploadedPath &amp;&amp; &lt;p style={{ color: 'green', marginTop: '5px' }}&gt;✓ 已上传&lt;/p&gt;}
        &lt;/div&gt;
      &lt;/div&gt;

      {/* ... 提交按钮 ... */}
    &lt;/div&gt;
  );
}
```

---

### 任务11: 端到端测试

**Files:**
- (无需新建文件，通过浏览器测试)

**Steps:**

- [ ] **Step 1: 启动后端**

```bash
cd backend
npm run init-db
npm run dev
```

- [ ] **Step 2: 启动前端**

```bash
cd frontend
npm start
```

- [ ] **Step 3: 完整流程测试**

1. 访问 http://localhost:3000
2. 点击"新建报价"
3. 填写表单并提交
4. 在详情页点击"计算报价"
5. 点击"执行AI审核"
6. 进行人工审核并提交
7. 导出PDF报价单

Expected: 完整流程顺利执行，各环节正常工作

---

## 计划总结

本计划包含11个任务，覆盖：
- ✅ 项目初始化（前后端）
- ✅ 数据模型和存储
- ✅ 报价计算引擎
- ✅ AI审核服务
- ✅ 人工审核流程
- ✅ 报价单生成
- ✅ 图纸上传
- ✅ 完整的用户界面

每个任务都可独立测试，最终任务11验证完整流程。
