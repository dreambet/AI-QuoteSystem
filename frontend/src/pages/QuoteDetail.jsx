import React, { useState, useEffect, useRef } from 'react';
import { useParams, Link } from 'react-router-dom';
import { quoteApi } from '../api/quotes';

const statusText = { draft: '草稿', calculated: '已计算', ai_reviewed: 'AI 已审核', ai_quoted: 'AI 已报价', manually_reviewed: '人工已审核', finalized: '已完成', rejected: '已驳回' };
const reviewStatusText = { pass: '通过', warning: '提醒', fail: '未通过' };
const severityText = { high: '高', medium: '中', low: '低' };
const cash = value => `¥${Number(value || 0).toFixed(2)}`;
const drawingName = value => value ? String(value).split(/[\\/]/).pop() : '未关联图纸';
const drawingType = value => { const name = drawingName(value); return name.includes('.') ? name.split('.').pop().toUpperCase() : 'CAD'; };

// 流式语义审核：从已累积的正文中提取已闭合的 finding 对象（扁平结构，花括号不嵌套），
// 供审核进行中增量渲染"长出"的发现卡片；未闭合/不完整的对象自然被跳过
function extractStreamingFindings(text) {
  const findings = [];
  const start = text.indexOf('"findings"');
  if (start < 0) return findings;
  const arrStart = text.indexOf('[', start);
  if (arrStart < 0) return findings;
  const re = /\{[^{}]*\}/g;
  let match;
  while ((match = re.exec(text.slice(arrStart + 1)))) {
    try {
      const finding = JSON.parse(match[0]);
      if (finding && (finding.message || finding.dimension)) findings.push(finding);
    } catch (_) { /* 不完整对象忽略 */ }
  }
  return findings;
}

// 语义审核发现卡片（最终态与流式增量态共用）：
// 「去修改」直达工作台第3步确认特征（resume + step 参数）
function SemanticFindingCard({ finding, quoteId }) {
  return <div className={`semantic-finding ${finding.severity || 'low'}`}>
    <div className="semantic-finding-head"><b>{finding.dimension || '待判定'}</b><span className="semantic-severity">{severityText[finding.severity] || finding.severity || '—'}</span></div>
    {finding.message && <p>{finding.message}</p>}
    {finding.evidence && <small>依据：{finding.evidence}</small>}
    <Link className="semantic-fix-link" to={`/quotes/ai-new?resume=${quoteId}&step=3`}>去修改（{finding.location || '确认特征'}）</Link>
  </div>;
}

function CalculationMethodPanel({ calculation, quantity, priceSnapshot, blankSpec }) {
  const trace = calculation?.formulaTrace || {};
  const processes = calculation?.processes || [];
  const additions = calculation?.additions || [];
  const count = Number(quantity) || 1;
  const traceRows = ['K', 'R', 'S', 'T', 'U', 'V', 'W', 'yieldAdjust'].filter(k => trace[k]);
  return <section className="detail-card calculation-method-card"><div className="detail-section-title"><div><span className="eyebrow">CALCULATION METHOD</span><h2>报价计算方法</h2></div><b>按成本分析公式链</b></div><p className="method-intro">K=毛重×单价 -> R=Σ机加工 -> 附加 -> S/T/U/V/W；修改工序或单价后需重新计算。</p>
    {priceSnapshot && <div className="method-material-details"><span>单价快照</span><p>单价 {priceSnapshot.unitPrice ?? '-'} {priceSnapshot.priceMode === 'fixed' ? '直接价格' : '元/kg'} · 来源 {priceSnapshot.source || '-'} · {priceSnapshot.confirmedAt ? new Date(priceSnapshot.confirmedAt).toLocaleString('zh-CN') : '未确认'}{priceSnapshot.stale ? ' · 已过期/待确认' : ''}{priceSnapshot.yieldRate ? ` · 良率 ${priceSnapshot.yieldRate}%` : ''}</p></div>}{blankSpec && blankSpec['余料重量'] && blankSpec['余料单价'] && <div className="method-material-details"><span>余料记录</span><p>余料重量 {blankSpec['余料重量']} kg × 余料单价 {blankSpec['余料单价']} 元/kg = {(Number(blankSpec['余料重量']) * Number(blankSpec['余料单价'])).toFixed(2)} 元（仅记录，不参与报价）</p></div>}
    {processes.length > 0 && <div className="method-process-list"><div><span>机加工工序明细</span><small>Q = 工费率/60 × 加工时长</small></div>{processes.map((item, index) => <p key={index}><b>{item.name}</b><span>{item.minutes} 分钟</span><span>@{item.hourlyRate}元/h</span><span>成本 ¥{Number(item.cost || 0).toFixed(2)}</span></p>)}</div>}
    {additions.length > 0 && <div className="method-process-list"><div><span>附加费用明细</span><small>损耗/重量/固定</small></div>{additions.map((item, index) => <p key={index}><b>{item.name}</b><span>{item.formula}</span><span>¥{Number(item.cost || 0).toFixed(2)}</span></p>)}</div>}
    <div className="calculation-breakdown">{traceRows.map(k => <div key={k}><span>{trace[k].label}</span><strong>{trace[k].expression}</strong></div>)}</div>
    <div className="calculation-breakdown"><div><span>总价</span><strong>单价 {cash(calculation.unitPrice)} × {count} 件 + 调机费 {cash(calculation.setupFee)} = {cash(calculation.total)}</strong></div></div>
  </section>;
}

function QuoteDetail() {
  const { id } = useParams();
  const [quote, setQuote] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [reviewData, setReviewData] = useState({ status: 'approved', comments: '' });
  const [showBreakdown, setShowBreakdown] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState('');
  const [reviewing, setReviewing] = useState(false);

  useEffect(() => {
    setQuote(null); setLoadError('');
    quoteApi.getById(id)
      .then(response => setQuote(response.data))
      .catch(error => setLoadError(error.response?.data?.error || '加载报价任务失败，请稍后重试或返回报价中心。'));
  }, [id]);
  // 计算方法弹窗打开时锁定背景滚动，避免弹窗内滚动带动详情页面
  useEffect(() => {
    document.body.style.overflow = showBreakdown ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [showBreakdown]);
  // 双层审核（流式）：规则层+历史基线本地秒出即展示（rules 事件），语义层 LLM 逐字流式约10~20秒；
  // 取消即断开上游生成不浪费 token；流式通道异常时降级非流式接口
  const [reviewStream, setReviewStream] = useState(null);
  const [reviewError, setReviewError] = useState('');
  const reviewAbortRef = useRef(null);
  const reviewReasonRef = useRef(null);
  const reviewStickRef = useRef(true);
  useEffect(() => () => { if (reviewAbortRef.current) reviewAbortRef.current.abort(); }, []);
  // 思考面板自动吸底：用户上滚超过 30px 即暂停跟随。
  // 修复偶发吸底失效：程序赋值 scrollTop 也会异步派发 scroll 事件，密集增量下事件到达时新内容已追加、
  // 距底部>30px，会被误判为用户上滚而停用吸底——以时间窗忽略程序滚动后短时间内的 scroll 事件
  const reviewAutoScrollAtRef = useRef(0);
  useEffect(() => {
    const el = reviewReasonRef.current;
    if (el && reviewStickRef.current) {
      reviewAutoScrollAtRef.current = Date.now();
      el.scrollTop = el.scrollHeight;
    }
  }, [reviewStream && reviewStream.reasoning]);
  const handleReviewReasonScroll = () => {
    if (Date.now() - reviewAutoScrollAtRef.current < 120) return;
    const el = reviewReasonRef.current;
    if (el) reviewStickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 30;
  };
  const aiReview = async () => {
    setReviewing(true);
    setReviewError('');
    setReviewStream({ rules: null, baseline: null, reasoning: '', text: '' });
    reviewStickRef.current = true;
    const abort = new AbortController();
    reviewAbortRef.current = abort;
    try {
      await quoteApi.aiReviewStream(id, {
        onRules: data => setReviewStream(s => s ? { ...s, rules: data.rules, baseline: data.baseline } : s),
        onDelta: (t, kind) => setReviewStream(s => s ? (kind === 'reasoning' ? { ...s, reasoning: s.reasoning + t } : { ...s, text: s.text + t }) : s),
        onDone: data => setQuote(q => ({ ...q, ...data.quote, drawingAnalysis: q.drawingAnalysis })),
        onError: data => setReviewError(data.message || 'AI 审核失败')
      }, abort.signal);
    } catch (error) {
      if (!abort.signal.aborted) {
        // 流式通道不可用 -> 降级非流式（后端语义层失败自身会静默降级为仅规则层）
        try { setQuote((await quoteApi.aiReview(id)).data); } catch (_) { setReviewError('AI 审核失败，请稍后重试'); }
      }
    } finally {
      setReviewing(false);
      setReviewStream(null);
      reviewAbortRef.current = null;
    }
  };
  const cancelReview = () => { if (reviewAbortRef.current) reviewAbortRef.current.abort(); };
  const manualReview = async () => setQuote((await quoteApi.manualReview(id, reviewData)).data);
  const exportExcel = async () => {
    setExporting(true); setExportError('');
    try {
      const response = await quoteApi.exportExcel(id);
      const blobUrl = URL.createObjectURL(new Blob([response.data], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
      const link = document.createElement('a');
      const filename = `核价单-${quote.partName || quote.id}.xlsx`;
      link.href = blobUrl; link.download = filename;
      document.body.appendChild(link); link.click(); link.remove();
      window.setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
    } catch (error) {
      setExportError('Excel 导出失败，请稍后重试。');
    } finally { setExporting(false); }
  };

  if (loadError) return <div className="detail-loading">{loadError}<Link className="back-link" to="/quotes">← 返回报价中心</Link></div>;
  if (!quote) return <div className="detail-loading">正在载入报价任务…</div>;
  const analysis = quote.drawingAnalysis || {};
  const aiQuote = quote.aiQuoteAnalysis || {};
  const calc = quote.calculation;
  const features = analysis.features || [];
  const costItems = calc ? [['材料成本 K', calc.materialCost], ['机加工成本 R', calc.machiningCost], ['管销 S', calc.overhead], ['小计 T', calc.subtotal], ['利润 U', calc.profit], ['含税 V', calc.taxIncluded], ['样品价 W', calc.samplePrice], ['调机费', calc.setupFee]] : [];

  // 「需修改」闭环：人工结论为需修改后，参数已变更（manualReview.stale）且用户重新完成了 AI 审核
  // （aiReview 已刷新未过期）时，放开人工审核表单重新提交 -> 通过后即可导出，避免反复修改-审核循环烧 token
  const manualResubmittable = !!quote.manualReview && quote.manualReview.status !== 'approved'
    && !!quote.aiReview && !quote.aiReview.stale
    && quote.aiReview.reviewedAt > (quote.manualReview.reviewedAt || '');

  return <div className="quote-detail-page">
    <header className="detail-hero">
      <div><Link className="back-link" to="/quotes">← 返回报价中心</Link><span className="eyebrow">QUOTATION DELIVERY / TASK #{quote.id}</span><h1>{quote.partName || '未命名零件'}</h1><p>{quote.material || '未指定材料'} · {quote.quantity || 1} 件</p></div>
      <div className="detail-hero-amount"><span className={`status-pill ${quote.status || 'draft'}`}>{statusText[quote.status] || quote.status || '草稿'}</span><strong>{calc ? cash(calc.total) : '待计算'}</strong><small>{calc ? `单价 ${cash(calc.unitPrice)}` : '完成参数核验后生成价格'}</small></div>
    </header>

    <div className="detail-layout">
      <main className="detail-main-column">
        <section className="detail-card overview-card"><div className="detail-section-title"><div><span className="eyebrow">PART OVERVIEW</span><h2>零件与图纸信息</h2></div><span className="drawing-type-chip">{drawingType(quote.drawingPath)}</span></div><div className="overview-grid"><div><span>物料编码</span><strong>{quote.materialCode || '—'}</strong></div><div><span>材料</span><strong>{quote.material || '—'}</strong></div><div><span>MOQ数量</span><strong>{quote.blankSpec?.['MOQ'] || '—'}</strong></div><div><span>毛重 / 净重</span><strong>{quote.grossWeight != null && quote.grossWeight !== '' ? Number(quote.grossWeight).toFixed(2) : '-'} / {quote.netWeight != null && quote.netWeight !== '' ? Number(quote.netWeight).toFixed(2) : '-'} kg</strong></div><div><span>余料</span><strong>{quote.blankSpec?.['余料重量'] && quote.blankSpec?.['余料单价'] ? `${quote.blankSpec['余料重量']} kg × ${quote.blankSpec['余料单价']} 元/kg（仅记录）` : '-'}</strong></div><div><span>毛坯尺寸</span><strong>{quote.blankSpec?.['料长'] || '—'} × {quote.blankSpec?.['料宽'] || '—'} × {quote.blankSpec?.['料厚'] || '—'} mm</strong></div><div><span>外径</span><strong>{quote.blankSpec?.['外径'] ? `${quote.blankSpec['外径']} mm` : '—'}</strong></div><div className="overview-file"><span>关联图纸</span><strong>{drawingName(quote.drawingPath)}</strong></div></div></section>

        <section className="detail-card price-detail-card"><div className="detail-section-title"><div><span className="eyebrow">PRICE SUMMARY</span><h2>报价明细</h2></div>{calc && <button type="button" className="detail-ghost-button" onClick={() => setShowBreakdown(value => !value)}>{showBreakdown ? '收起计算方法' : '查看计算方法'}</button>}</div>{calc ? <><div className="detail-cost-grid">{costItems.map(([label, value]) => <div key={label}><span>{label}</span><strong>{cash(value)}</strong></div>)}</div><div className="detail-total"><span>参考总价</span><strong>{cash(calc.total)}</strong><small>单价 {cash(calc.unitPrice)} · 数量 {quote.quantity || 1}</small></div></> : <div className="detail-empty-inline"><Link className="primary-action link-action" to={`/quotes/ai-new?resume=${quote.id}`}>继续报价流程</Link></div>}</section>

        {(aiQuote.materialRecommendation || aiQuote.processSuggestions?.length || aiQuote.warningPoints?.length || aiQuote.suggestions?.length) && <section className="detail-card ai-advice-detail"><div className="detail-section-title"><div><span className="eyebrow">AI QUOTATION INTELLIGENCE</span><h2>AI 报价建议</h2></div><b>已生成</b></div><div className="advice-detail-grid">{aiQuote.materialRecommendation && <div><span>材料推荐</span><p>{aiQuote.materialRecommendation}</p></div>}{aiQuote.processSuggestions?.length > 0 && <div><span>工艺建议</span><ul>{aiQuote.processSuggestions.map((item, index) => <li key={index}><strong>{item.process}</strong>：{item.reason}{item.estimatedTime ? `（${item.estimatedTime}）` : ''}</li>)}</ul></div>}{aiQuote.warningPoints?.length > 0 && <div className="advice-warning"><span>风险提示</span><ul>{aiQuote.warningPoints.map((item, index) => <li key={index}>{item}</li>)}</ul></div>}{aiQuote.suggestions?.length > 0 && <div><span>优化建议</span><ul>{aiQuote.suggestions.map((item, index) => <li key={index}>{item}</li>)}</ul></div>}</div></section>}
      </main>

      <aside className="detail-side-column">
        <section className="detail-card analysis-detail-card"><div className="detail-section-title"><div><span className="eyebrow">AI DRAWING ANALYSIS</span><h2>图纸识别结果</h2></div><b>{features.length} 项特征</b></div><div className="analysis-detail-grid analysis-detail-side"><div className="feature-result-panel"><div className="feature-result-heading"><span>识别特征</span><small>滚动查看全部</small></div>{features.length ? <div className="detail-feature-scroll">{features.map((feature, index) => <div className="detail-feature-row" key={`${feature.type}-${index}`}><span>#{String(index + 1).padStart(2, '0')}</span><div><strong>{feature.type || 'CAD 特征'}</strong><small>{feature.description || '已从图纸几何信息中识别'}</small></div></div>)}</div> : <div className="detail-empty-inline">该任务尚未生成特征识别结果。</div>}</div><div className="analysis-meta-panel">{analysis.tolerances && <div><span>一般公差</span><strong>{analysis.tolerances.general || '—'}</strong></div>}<div className="analysis-note"><span>分析备注</span><p>{`识别实体：${analysis.cadInfo?.entityCount ?? '—'} 项\n${analysis.notes || '暂无额外图纸分析备注。'}`}</p></div></div></div></section>

        <section className="detail-card review-detail-card">
          <div className="detail-section-title"><div><span className="eyebrow">REVIEW WORKFLOW</span><h2>审核与交付</h2></div>{quote.aiReview && <b>{quote.aiReview.stale ? '参数已变更' : '已审核'}</b>}</div>

          {reviewing && reviewStream ? (
            <div className="review-result review-streaming">
              <div className="review-layer-head">
                {reviewStream.rules
                  ? <span className={`review-status-pill ${reviewStream.rules.status}`}>{reviewStatusText[reviewStream.rules.status] || reviewStream.rules.status}</span>
                  : <span className="review-status-pill">检测中</span>}
                <small>规则层已出 · 语义层流式生成中</small>
              </div>
              {reviewStream.baseline?.firstQuote && <p className="review-baseline-first">该物料编码首次报价，无历史基线可比对。</p>}
              {reviewStream.baseline && !reviewStream.baseline.firstQuote && reviewStream.baseline.deviation && <p className="review-baseline-first">历史基线：单件价较历史均值偏离 {reviewStream.baseline.deviation}。</p>}
              {reviewStream.reasoning && <details className="stream-reasoning" open><summary>思考过程（{reviewStream.reasoning.length} 字）</summary><pre ref={reviewReasonRef} onScroll={handleReviewReasonScroll}>{reviewStream.reasoning}</pre></details>}
              <div className="semantic-findings">
                <div className="review-layer-head"><b>语义审核</b><small>AI 质检</small></div>
                {extractStreamingFindings(reviewStream.text).map((finding, index) => <SemanticFindingCard key={index} finding={finding} quoteId={quote.id} />)}
                <div className="skeleton-line" />
              </div>
              <button type="button" className="detail-ghost-button review-cancel-button" onClick={cancelReview}>取消审核</button>
            </div>
          ) : quote.aiReview ? (
            <div className="review-result">
              <div className="review-layer-head">
                <span className={`review-status-pill ${quote.aiReview.status}`}>{reviewStatusText[quote.aiReview.status] || quote.aiReview.status}</span>
                <small>规则层</small>
              </div>
              {quote.aiReview.stale && <em className="review-stale-tag">报价参数已变更，以下审核结果过期，请重新审核</em>}
              <ul>{(quote.aiReview.comments || []).map((item, index) => <li key={index}>{item}</li>)}</ul>
              {quote.aiReview.suggestions?.length > 0 && <ul>{quote.aiReview.suggestions.map((item, index) => <li key={index}>{item}</li>)}</ul>}

              {quote.aiReview.baseline && !quote.aiReview.baseline.firstQuote && (
                <div className="review-baseline">
                  <div className="review-layer-head"><b>历史基线</b><small>同物料编码 {quote.materialCode}</small></div>
                  {quote.aiReview.baseline.deviation && <p>单件价较历史均值偏离 <strong className={quote.aiReview.baseline.deviation === '正常' ? '' : 'deviation-warn'}>{quote.aiReview.baseline.deviation}{quote.aiReview.baseline.deviationLevel != null ? `（${(quote.aiReview.baseline.deviationLevel * 100).toFixed(1)}%）` : ''}</strong></p>}
                  {quote.aiReview.baseline.processDiff && <p>{quote.aiReview.baseline.processDiff}</p>}
                  {quote.aiReview.baseline.durationFlags?.length > 0 && <p>{quote.aiReview.baseline.durationFlags.map(f => `${f.process}时长为历史${f.multiple}倍`).join('；')}</p>}
                </div>
              )}
              {quote.aiReview.baseline?.firstQuote && <p className="review-baseline-first">该物料编码首次报价，无历史基线可比对。</p>}

              {quote.aiReview.semantic && quote.manualReview?.status !== 'approved' && (
                <div className="semantic-findings">
                  <div className="review-layer-head"><b>语义审核</b><small>AI 质检</small></div>
                  {quote.aiReview.semantic.findings?.length > 0 ? quote.aiReview.semantic.findings.map((finding, index) => (
                    <SemanticFindingCard key={index} finding={finding} quoteId={quote.id} />
                  )) : <p className="detail-muted">{quote.aiReview.semantic.summary || '语义审核未发现明显疏漏。'}</p>}
                </div>
              )}

              {quote.aiReview.stale && <button type="button" className="secondary-action full-action" onClick={aiReview} disabled={reviewing}>{reviewing ? 'AI 审核中…' : '重新执行 AI 审核'}</button>}
            </div>
          ) : calc ? (
            <button type="button" className="secondary-action full-action" onClick={aiReview} disabled={reviewing}>{reviewing ? '双层审核中…规则层已出，语义层约需10~20秒' : '执行 AI 审核'}</button>
          ) : (
            <p className="detail-muted">完成报价计算后可进行 AI 审核。</p>
          )}

          {quote.aiReview && (!quote.manualReview || manualResubmittable) && <div className="manual-review-form">{manualResubmittable && <p className="detail-muted">参数修改后已重新完成 AI 审核，请重新提交人工审核结论。</p>}<label>审核结论<select value={reviewData.status} onChange={event => setReviewData(data => ({ ...data, status: event.target.value }))}><option value="approved">通过</option><option value="needs_modification">需修改</option></select></label><label>审核意见<textarea value={reviewData.comments} onChange={event => setReviewData(data => ({ ...data, comments: event.target.value }))} placeholder="填写人工审核意见" /></label><button type="button" className="primary-action full-action" onClick={manualReview}>提交人工审核</button></div>}
          {quote.manualReview && <div className="manual-review-complete"><span>人工审核：{quote.manualReview.status === 'approved' ? '通过' : quote.manualReview.status === 'rejected' ? '拒绝' : '需修改'}</span>{quote.manualReview.stale && <em className="review-stale-tag">报价参数已变更，建议重新审核</em>}<p>{quote.manualReview.comments || '未填写额外意见'}</p></div>}
          {quote.manualReview?.status === 'approved' && <button type="button" className="export-button full-action" disabled={exporting} onClick={exportExcel}>{exporting ? '正在生成 Excel…' : '导出核价单 Excel'}</button>}
          {reviewError && <p className="export-error">{reviewError}</p>}
          {exportError && <p className="export-error">{exportError}</p>}
        </section>
      </aside>
    </div>
    {showBreakdown && <div className="console-modal-mask" onClick={() => setShowBreakdown(false)}><div className="console-modal method-modal" onClick={event => event.stopPropagation()}><div className="console-modal-head"><div><span>报价计算方法</span><small>按成本分析公式链 K->R->附加->S/T/U/V/W；修改工序或单价后需重新计算。</small></div><button type="button" onClick={() => setShowBreakdown(false)}>×</button></div><div className="console-modal-body"><CalculationMethodPanel calculation={calc} quantity={quote.quantity} priceSnapshot={quote.priceSnapshot} blankSpec={quote.blankSpec} /></div></div></div>}
  </div>;
}

export default QuoteDetail;
