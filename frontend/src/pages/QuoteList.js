import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { quoteApi } from '../api/quotes';

const statusMap = { draft: '草稿', calculated: '已计算', ai_reviewed: 'AI 已审核', ai_quoted: 'AI 已报价', manually_reviewed: '人工已审核', finalized: '已完成', rejected: '已驳回' };

const FIELD_OPTIONS = [
  { value: 'materialCode', label: '物料编码' },
  { value: 'partName', label: '品名' },
  { value: 'partDescription', label: '物料描述' },
  { value: 'q', label: '全部' }
];
const fieldLabel = f => (FIELD_OPTIONS.find(o => o.value === f) || {}).label || f;

function QuoteList() {
  const [quotes, setQuotes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchField, setSearchField] = useState('materialCode');
  const [searchValue, setSearchValue] = useState('');
  const [trace, setTrace] = useState({ open: false, field: 'materialCode', value: '', results: [], loading: false });

  const loadQuotes = (params) => {
    setLoading(true);
    quoteApi.getAll(params).then(r => setQuotes(r.data)).catch(() => setQuotes([])).finally(() => setLoading(false));
  };
  useEffect(() => { loadQuotes({}); }, []);

  const handleSearch = () => {
    const v = searchValue.trim();
    loadQuotes(v ? { [searchField]: v } : {});
  };
  const handleReset = () => { setSearchValue(''); loadQuotes({}); };

  const openTrace = async (field, value) => {
    if (!value) return;
    setTrace({ open: true, field, value, results: [], loading: true });
    try {
      const r = await quoteApi.getAll({ [field]: value });
      setTrace(t => ({ ...t, results: r.data, loading: false }));
    } catch { setTrace(t => ({ ...t, results: [], loading: false })); }
  };

  const calculated = quotes.filter(q => q.calculation).length;
  const reviewed = quotes.filter(q => ['ai_reviewed', 'ai_quoted', 'finalized'].includes(q.status)).length;
  const codeCount = new Set(quotes.map(q => q.materialCode).filter(Boolean)).size;

  const codeButton = (code) => code
    ? <button type="button" className="table-view-link trace-code-btn" onClick={() => openTrace('materialCode', code)} title="点击追溯同物料编码历史报价">{code}</button>
    : <span className="detail-muted">-</span>;

  return <div className="quote-center-page">
    <section className="quote-center-hero">
      <div><span className="eyebrow">MACHINING QUOTATION / COMMAND CENTER</span><h1>报价中心</h1><p>统一管理零件任务、成本计算与 AI 审核结果；可按物料编码 / 品名 / 物料描述追溯历史报价单。</p></div>
      <div className="quote-center-actions"><Link className="secondary-action link-action" to="/quotes/new">新建基础报价</Link><Link className="primary-action link-action" to="/quotes/ai-new">进入 AI 分析工作台</Link></div>
    </section>
    <section className="quote-center-stats">
      <div><span>全部任务</span><strong>{quotes.length}</strong><small>报价记录总数</small></div>
      <div><span>已完成计算</span><strong>{calculated}</strong><small>已生成参考价格</small></div>
      <div><span>涉及物料编码</span><strong>{codeCount}</strong><small>不同物料编码数</small></div>
      <div><span>已完成审核</span><strong>{reviewed}</strong><small>AI 或人工复核</small></div>
    </section>
    <section className="quote-table-card">
      <div className="quote-table-heading"><div><span className="eyebrow">RECENT QUOTATIONS</span><h2>报价任务列表</h2></div><span>{loading ? '正在同步数据…' : `${quotes.length} 条记录`}</span></div>
      <div className="quote-trace-bar">
        <span className="trace-label">追溯检索</span>
        <select value={searchField} onChange={e => setSearchField(e.target.value)}>{FIELD_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</select>
        <input value={searchValue} onChange={e => setSearchValue(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') handleSearch(); }} placeholder="输入关键字，回车搜索历史报价" />
        <button type="button" className="primary-action" onClick={handleSearch}>搜索</button>
        <button type="button" className="secondary-action" onClick={handleReset}>重置</button>
      </div>
      {loading ? <div className="console-empty">正在加载报价任务…</div> : quotes.length ? <div className="quote-table-wrap"><table className="quote-table"><thead><tr><th>零件任务</th><th>物料编码</th><th>材料 / 精度</th><th>数量</th><th>参考总价</th><th>状态</th><th aria-label="操作" /></tr></thead><tbody>{quotes.map(quote => <tr key={quote.id}>
        <td><strong>{quote.partName || '未命名零件'}</strong><small>{quote.partNumber || `任务 #${quote.id}`}</small></td>
        <td>{codeButton(quote.materialCode)}</td>
        <td><strong>{quote.material || '-'}</strong><small>{quote.precision || '中等'} 精度</small></td>
        <td>{quote.quantity || 1} 件</td>
        <td className="quote-price">{quote.calculation ? `¥${Number(quote.calculation.total).toFixed(2)}` : '待计算'}</td>
        <td><span className={`status-pill ${quote.status || 'draft'}`}>{statusMap[quote.status] || quote.status || '草稿'}</span></td>
        <td><Link className="table-view-link" to={`/quotes/${quote.id}`}>查看 -&gt;</Link></td>
      </tr>)}</tbody></table></div> : <div className="quote-empty"><div className="empty-mark">+</div><h3>尚未创建报价任务</h3><p>从 AI 工作台上传图纸，或创建一份基础报价开始。</p><Link className="primary-action link-action" to="/quotes/ai-new">创建首个分析任务</Link></div>}
    </section>

    {trace.open && <>
      <div className="trace-drawer-mask" onClick={() => setTrace(t => ({ ...t, open: false }))} />
      <div className="trace-drawer">
        <div className="trace-drawer-head"><h3>{fieldLabel(trace.field)}追溯 · {trace.value}</h3><button type="button" onClick={() => setTrace(t => ({ ...t, open: false }))}>×</button></div>
        <div className="trace-drawer-body">
          {trace.loading ? <div className="console-empty">正在加载历史报价…</div> : trace.results.length ? trace.results.map(q => (
            <Link key={q.id} className="trace-item" to={`/quotes/${q.id}`} onClick={() => setTrace(t => ({ ...t, open: false }))}>
              <strong>{q.partName || '未命名零件'} <span className="trace-price">{q.calculation ? `¥${Number(q.calculation.total).toFixed(2)}` : '待计算'}</span></strong>
              <small>物料编码 {q.materialCode || '-'} · {q.createdAt ? new Date(q.createdAt).toLocaleDateString('zh-CN') : '-'}</small>
              <small>单价 {q.priceSnapshot?.unitPrice ?? '-'} 元/kg · {statusMap[q.status] || q.status || '草稿'}</small>
            </Link>
          )) : <div className="console-empty">未找到同{fieldLabel(trace.field)}的历史报价单。</div>}
        </div>
      </div>
    </>}
  </div>;
}

export default QuoteList;
