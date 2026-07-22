
import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { quoteApi } from '../api/quotes';

function QuoteList() {
  const [quotes, setQuotes] = useState([]);

  useEffect(() => {
    loadQuotes();
  }, []);

  const loadQuotes = async () => {
    const response = await quoteApi.getAll();
    setQuotes(response.data);
  };

  const getStatusText = (status) => {
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

