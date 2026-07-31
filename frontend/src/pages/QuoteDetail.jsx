import React, { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { quoteApi } from '../api/quotes';

const statusText = { draft: '草稿', calculated: '已计算', ai_reviewed: 'AI 已审核', manually_reviewed: '人工已审核', finalized: '已完成' };
const cash = value => `¥${Number(value || 0).toFixed(2)}`;
const drawingName = value => value ? String(value).split(/[\\/]/).pop() : '未关联图纸';
const drawingType = value => { const name = drawingName(value); return name.includes('.') ? name.split('.').pop().toUpperCase() : 'CAD'; };

function CalculationMethodPanel({ calculation, quantity }) {
  const breakdown = calculation?.breakdown || {};
  const volume = breakdown.volumeCalculation || {};
  const material = breakdown.materialCalculation || {};
  const process = breakdown.processBreakdown || {};
  const count = Number(quantity) || 1;
  const perUnit = value => Number(value || 0) / count;
  const directCost = perUnit(calculation.materialCost) + perUnit(calculation.laborCost) + perUnit(calculation.equipmentCost);
  const methods = [
    { index: '01', title: '体积与重量', formula: volume.formula || '未返回体积计算公式', detail: volume.dimensions || '未返回尺寸参数', result: `体积 ${Number(breakdown.volume || 0).toFixed(4)} cm³ · 重量 ${Number(breakdown.weight || 0).toFixed(3)} kg` },
    { index: '02', title: '材料成本', formula: material.formula || '材料成本 = 重量 × 材料单价', detail: `密度 ${breakdown.density ?? '—'} g/cm³ · 单价 ${breakdown.materialPricePerKg ?? '—'} 元/kg`, result: `¥${perUnit(calculation.materialCost).toFixed(2)} / 件` },
    { index: '03', title: '工序与工时', formula: '单道工时 = √体积 × 工序系数 × 精度系数 ÷ 10', detail: `精度系数 ${breakdown.precisionFactor ?? '—'}x · 总工时 ${process.summary?.totalTime ?? '—'} h`, result: `人工 ¥${perUnit(calculation.laborCost).toFixed(2)} / 件 · 设备 ¥${perUnit(calculation.equipmentCost).toFixed(2)} / 件` },
    { index: '04', title: '管理费与利润', formula: '管理费 = 直接成本 × 15%；利润 =（直接成本 + 管理费）× 20%', detail: `直接成本 ¥${directCost.toFixed(2)} / 件`, result: `管理费 ¥${perUnit(calculation.overheadCost).toFixed(2)} · 利润 ¥${perUnit(calculation.profit).toFixed(2)} / 件` },
    { index: '05', title: '报价汇总', formula: '单价 = 材料 + 人工 + 设备 + 管理费 + 利润；总价 = 单价 × 数量', detail: `数量 ${count} 件`, result: `单价 ¥${Number(calculation.unitPrice || 0).toFixed(2)} · 总价 ¥${Number(calculation.total || 0).toFixed(2)}` }
  ];
  return <section className="detail-card calculation-method-card"><div className="detail-section-title"><div><span className="eyebrow">CALCULATION METHOD</span><h2>报价计算方法</h2></div><b>按当前参数计算</b></div><p className="method-intro">以下为系统本次报价采用的计算路径；修改材料、尺寸、精度或数量后需重新计算。</p><div className="method-card-grid">{methods.map(method => <article className="method-card" key={method.index}><span className="method-index">{method.index}</span><div><h3>{method.title}</h3><code>{method.formula}</code><p>{method.detail}</p><strong>{method.result}</strong></div></article>)}</div>{material.details?.length > 0 && <div className="method-material-details"><span>材料计算依据</span>{material.details.map((item, index) => <p key={index}>{item}</p>)}</div>}{process.processes?.length > 0 && <div className="method-process-list"><div><span>工序成本拆分</span><small>工时与设备费按精度系数调整</small></div>{process.processes.map((item, index) => <p key={index}><b>{item.name}</b><span>{item.estimatedTime} h</span><span>人工 ¥{item.laborCost}</span><span>设备 ¥{item.equipmentCost}</span></p>)}</div>}</section>;
}

function QuoteDetail() {
  const { id } = useParams();
  const [quote, setQuote] = useState(null);
  const [reviewData, setReviewData] = useState({ status: 'approved', comments: '' });
  const [showBreakdown, setShowBreakdown] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState('');

  useEffect(() => { quoteApi.getById(id).then(response => setQuote(response.data)); }, [id]);
  const calculate = async () => setQuote((await quoteApi.calculate(id)).data);
  const aiReview = async () => setQuote((await quoteApi.aiReview(id)).data);
  const manualReview = async () => setQuote((await quoteApi.manualReview(id, reviewData)).data);
  const exportPdf = async () => {
    setExporting(true); setExportError('');
    try {
      const response = await quoteApi.export(id);
      const blobUrl = URL.createObjectURL(new Blob([response.data], { type: 'application/pdf' }));
      const link = document.createElement('a');
      const filename = `报价单-${quote.partName || quote.id}.pdf`;
      link.href = blobUrl; link.download = filename;
      document.body.appendChild(link); link.click(); link.remove();
      window.setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
    } catch (error) {
      setExportError('PDF 导出失败，请稍后重试。');
    } finally { setExporting(false); }
  };

  if (!quote) return <div className="detail-loading">正在载入报价任务…</div>;
  const analysis = quote.drawingAnalysis || {};
  const aiQuote = quote.aiQuoteAnalysis || {};
  const calc = quote.calculation;
  const features = analysis.features || [];
  const costItems = calc ? [['材料成本', calc.materialCost], ['人工成本', calc.laborCost], ['设备费用', calc.equipmentCost], ['管理费用', calc.overheadCost], ['利润', calc.profit]] : [];

  return <div className="quote-detail-page">
    <header className="detail-hero">
      <div><Link className="back-link" to="/quotes">← 返回报价中心</Link><span className="eyebrow">QUOTATION DELIVERY / TASK #{quote.id}</span><h1>{quote.partName || '未命名零件'}</h1><p>{quote.partNumber || '未填写零件编号'} · {quote.material || '未指定材料'} · {quote.quantity || 1} 件 · {quote.precision || '中等'}精度</p></div>
      <div className="detail-hero-amount"><span className={`status-pill ${quote.status || 'draft'}`}>{statusText[quote.status] || quote.status || '草稿'}</span><strong>{calc ? cash(calc.total) : '待计算'}</strong><small>{calc ? `单价 ${cash(calc.unitPrice)}` : '完成参数核验后生成价格'}</small></div>
    </header>

    <div className="detail-layout">
      <main className="detail-main-column">
        <section className="detail-card overview-card"><div className="detail-section-title"><div><span className="eyebrow">PART OVERVIEW</span><h2>零件与图纸信息</h2></div><span className="drawing-type-chip">{drawingType(quote.drawingPath)}</span></div><div className="overview-grid"><div><span>材料</span><strong>{quote.material || '—'}</strong></div><div><span>数量</span><strong>{quote.quantity || 1} 件</strong></div><div><span>尺寸</span><strong>{quote.length || '—'} × {quote.width || '—'} × {quote.height || '—'} mm</strong></div><div><span>直径</span><strong>{quote.diameter ? `${quote.diameter} mm` : '—'}</strong></div><div className="overview-file"><span>关联图纸</span><strong>{drawingName(quote.drawingPath)}</strong></div></div></section>

        <section className="detail-card analysis-detail-card"><div className="detail-section-title"><div><span className="eyebrow">AI DRAWING ANALYSIS</span><h2>图纸识别结果</h2></div><b>{features.length} 项特征</b></div><div className="analysis-detail-grid"><div className="feature-result-panel"><div className="feature-result-heading"><span>识别特征</span><small>滚动查看全部</small></div>{features.length ? <div className="detail-feature-scroll">{features.map((feature, index) => <div className="detail-feature-row" key={`${feature.type}-${index}`}><span>#{String(index + 1).padStart(2, '0')}</span><div><strong>{feature.type || 'CAD 特征'}</strong><small>{feature.description || '已从图纸几何信息中识别'}</small></div></div>)}</div> : <div className="detail-empty-inline">该任务尚未生成特征识别结果。</div>}</div><div className="analysis-meta-panel"><div><span>复杂程度</span><strong>{analysis.complexity || '待分析'}</strong></div><div><span>识别实体</span><strong>{analysis.cadInfo?.entityCount ?? '—'}</strong></div>{analysis.tolerances && <div><span>一般公差</span><strong>{analysis.tolerances.general || '—'}</strong></div>}<div className="analysis-note"><span>分析备注</span><p>{analysis.notes || '暂无额外图纸分析备注。'}</p></div></div></div></section>

        {(aiQuote.materialRecommendation || aiQuote.processSuggestions?.length || aiQuote.warningPoints?.length || aiQuote.suggestions?.length) && <section className="detail-card ai-advice-detail"><div className="detail-section-title"><div><span className="eyebrow">AI QUOTATION INTELLIGENCE</span><h2>AI 报价建议</h2></div><b>已生成</b></div><div className="advice-detail-grid">{aiQuote.materialRecommendation && <div><span>材料推荐</span><p>{aiQuote.materialRecommendation}</p></div>}{aiQuote.processSuggestions?.length > 0 && <div><span>工艺建议</span><ul>{aiQuote.processSuggestions.map((item, index) => <li key={index}><strong>{item.process}</strong>：{item.reason}{item.estimatedTime ? `（${item.estimatedTime}）` : ''}</li>)}</ul></div>}{aiQuote.warningPoints?.length > 0 && <div className="advice-warning"><span>风险提示</span><ul>{aiQuote.warningPoints.map((item, index) => <li key={index}>{item}</li>)}</ul></div>}{aiQuote.suggestions?.length > 0 && <div><span>优化建议</span><ul>{aiQuote.suggestions.map((item, index) => <li key={index}>{item}</li>)}</ul></div>}</div></section>}
      </main>

      <aside className="detail-side-column">
        <section className="detail-card price-detail-card"><div className="detail-section-title"><div><span className="eyebrow">PRICE SUMMARY</span><h2>报价明细</h2></div>{calc && <button type="button" className="detail-ghost-button" onClick={() => setShowBreakdown(value => !value)}>{showBreakdown ? '收起计算方法' : '查看计算方法'}</button>}</div>{calc ? <><div className="detail-cost-list">{costItems.map(([label, value]) => <div key={label}><span>{label}</span><strong>{cash(value)}</strong></div>)}</div><div className="detail-total"><span>参考总价</span><strong>{cash(calc.total)}</strong><small>单价 {cash(calc.unitPrice)}</small></div>{showBreakdown && <CalculationMethodPanel calculation={calc} quantity={quote.quantity} />}</> : <div className="detail-empty-inline"><p>尚未计算报价。</p><button type="button" className="primary-action" onClick={calculate}>计算报价</button></div>}</section>

        <section className="detail-card review-detail-card"><div className="detail-section-title"><div><span className="eyebrow">REVIEW WORKFLOW</span><h2>审核与交付</h2></div></div>{quote.aiReview ? <div className="review-result"><span>AI 审核：{quote.aiReview.status}</span><ul>{(quote.aiReview.comments || []).map((item, index) => <li key={index}>{item}</li>)}</ul>{quote.aiReview.suggestions?.length > 0 && <ul>{quote.aiReview.suggestions.map((item, index) => <li key={index}>{item}</li>)}</ul>}</div> : calc ? <button type="button" className="secondary-action full-action" onClick={aiReview}>执行 AI 审核</button> : <p className="detail-muted">完成报价计算后可进行 AI 审核。</p>}{quote.aiReview && !quote.manualReview && <div className="manual-review-form"><label>审核结论<select value={reviewData.status} onChange={event => setReviewData(data => ({ ...data, status: event.target.value }))}><option value="approved">通过</option><option value="rejected">拒绝</option><option value="needs_modification">需修改</option></select></label><label>审核意见<textarea value={reviewData.comments} onChange={event => setReviewData(data => ({ ...data, comments: event.target.value }))} placeholder="填写人工审核意见" /></label><button type="button" className="primary-action full-action" onClick={manualReview}>提交人工审核</button></div>}{quote.manualReview && <div className="manual-review-complete"><span>人工审核：{quote.manualReview.status}</span><p>{quote.manualReview.comments || '未填写额外意见'}</p></div>}{quote.manualReview?.status === 'approved' && <button type="button" className="export-button full-action" disabled={exporting} onClick={exportPdf}>{exporting ? '正在生成 PDF…' : '导出报价单 PDF'}</button>}{exportError && <p className="export-error">{exportError}</p>}</section>
      </aside>
    </div>
  </div>;
}

export default QuoteDetail;
