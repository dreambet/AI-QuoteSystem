import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { quoteApi } from '../api/quotes';

const statusMap = { draft: '草稿', calculated: '已计算', ai_reviewed: 'AI 已审核', manually_reviewed: '人工已审核', finalized: '已完成' };

function QuoteList() {
  const [quotes, setQuotes] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    quoteApi.getAll().then(response => setQuotes(response.data)).catch(() => setQuotes([])).finally(() => setLoading(false));
  }, []);

  const calculated = quotes.filter(quote => quote.calculation).length;
  const reviewed = quotes.filter(quote => quote.status === 'ai_reviewed' || quote.status === 'finalized').length;
  return <div className="quote-center-page">
    <section className="quote-center-hero">
      <div><span className="eyebrow">MACHINING QUOTATION / COMMAND CENTER</span><h1>报价中心</h1><p>统一管理零件任务、成本计算与 AI 审核结果。</p></div>
      <div className="quote-center-actions"><Link className="secondary-action link-action" to="/quotes/new">新建基础报价</Link><Link className="primary-action link-action" to="/quotes/ai-new">进入 AI 分析工作台</Link></div>
    </section>
    <section className="quote-center-stats">
      <div><span>全部任务</span><strong>{quotes.length}</strong><small>报价记录总数</small></div>
      <div><span>已完成计算</span><strong>{calculated}</strong><small>已生成参考价格</small></div>
      <div><span>已完成审核</span><strong>{reviewed}</strong><small>AI 或人工复核</small></div>
    </section>
    <section className="quote-table-card">
      <div className="quote-table-heading"><div><span className="eyebrow">RECENT QUOTATIONS</span><h2>报价任务列表</h2></div><span>{loading ? '正在同步数据…' : `${quotes.length} 条记录`}</span></div>
      {loading ? <div className="console-empty">正在加载报价任务…</div> : quotes.length ? <div className="quote-table-wrap"><table className="quote-table"><thead><tr><th>零件任务</th><th>材料 / 精度</th><th>数量</th><th>参考总价</th><th>状态</th><th aria-label="操作" /></tr></thead><tbody>{quotes.map(quote => <tr key={quote.id}><td><strong>{quote.partName || '未命名零件'}</strong><small>{quote.partNumber || `任务 #${quote.id}`}</small></td><td><strong>{quote.material || '—'}</strong><small>{quote.precision || '中等'} 精度</small></td><td>{quote.quantity || 1} 件</td><td className="quote-price">{quote.calculation ? `¥${Number(quote.calculation.total).toFixed(2)}` : '待计算'}</td><td><span className={`status-pill ${quote.status || 'draft'}`}>{statusMap[quote.status] || quote.status || '草稿'}</span></td><td><Link className="table-view-link" to={`/quotes/${quote.id}`}>查看 →</Link></td></tr>)}</tbody></table></div> : <div className="quote-empty"><div className="empty-mark">+</div><h3>尚未创建报价任务</h3><p>从 AI 工作台上传图纸，或创建一份基础报价开始。</p><Link className="primary-action link-action" to="/quotes/ai-new">创建首个分析任务</Link></div>}
    </section>
  </div>;
}

export default QuoteList;
