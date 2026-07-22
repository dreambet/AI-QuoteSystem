
import React, { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { quoteApi } from '../api/quotes';

function QuoteDetail() {
  const { id } = useParams();
  const [quote, setQuote] = useState(null);
  const [reviewData, setReviewData] = useState({ status: 'approved', comments: '' });

  useEffect(() => {
    loadQuote();
  }, [id]);

  const loadQuote = async () => {
    const response = await quoteApi.getById(id);
    setQuote(response.data);
  };

  const handleCalculate = async () => {
    const response = await quoteApi.calculate(id);
    setQuote(response.data);
  };

  const handleAIReview = async () => {
    const response = await quoteApi.aiReview(id);
    setQuote(response.data);
  };

  const handleManualReview = async () => {
    const response = await quoteApi.manualReview(id, reviewData);
    setQuote(response.data);
  };

  const handleExport = () => {
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
          &lt;button onClick={handleCalculate} style={{
            padding: '12px 24px',
            backgroundColor: '#007bff',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer',
            fontSize: '16px'
          }}&gt;
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
          &lt;button onClick={handleAIReview} style={{
            padding: '12px 24px',
            backgroundColor: '#ff9800',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer',
            fontSize: '16px'
          }}&gt;
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
          &lt;button onClick={handleManualReview} style={{
            padding: '12px 24px',
            backgroundColor: '#4caf50',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer',
            fontSize: '16px'
          }}&gt;
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
          &lt;button onClick={handleExport} style={{
            padding: '12px 24px',
            backgroundColor: '#9c27b0',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer',
            fontSize: '16px'
          }}&gt;
            导出报价单 (PDF)
          &lt;/button&gt;
        &lt;/div&gt;
      )}
    &lt;/div&gt;
  );
}

export default QuoteDetail;

