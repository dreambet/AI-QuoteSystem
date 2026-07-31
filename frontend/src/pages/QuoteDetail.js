import React, { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { quoteApi } from '../api/quotes';

function QuoteDetail() {
  const { id } = useParams();
  const [quote, setQuote] = useState(null);
  const [reviewData, setReviewData] = useState({ status: 'approved', comments: '' });
  const [showDetailedCalculation, setShowDetailedCalculation] = useState(false);

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

  if (!quote) return <div>加载中...</div>;

  return (
    <div style={{ padding: '20px', maxWidth: '1200px', margin: '0 auto' }}>
      <div style={{ marginBottom: '20px' }}>
        <Link to="/quotes">← 返回列表</Link>
      </div>

      <h2>报价详情 - {quote.partName}</h2>

      <div style={{ backgroundColor: '#f5f5f5', padding: '20px', marginBottom: '20px', borderRadius: '4px' }}>
        <h3>基本信息</h3>
        <p><strong>零件编号:</strong> {quote.partNumber || '-'}</p>
        <p><strong>材料:</strong> {quote.material}</p>
        <p><strong>尺寸:</strong> {quote.length || '-'} x {quote.width || '-'} x {quote.height || '-'} mm</p>
        {quote.diameter && <p><strong>直径:</strong> {quote.diameter} mm</p>}
        <p><strong>数量:</strong> {quote.quantity}</p>
        <p><strong>精度:</strong> {quote.precision}</p>
        <p><strong>状态:</strong> {quote.status}</p>
      </div>

      {quote.calculation ? (
        <>
          <div style={{ backgroundColor: '#e8f5e9', padding: '20px', marginBottom: '20px', borderRadius: '4px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
              <h3 style={{ margin: 0 }}>报价明细</h3>
              <button
                onClick={() => setShowDetailedCalculation(!showDetailedCalculation)}
                style={{
                  padding: '8px 16px',
                  backgroundColor: '#007bff',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer'
                }}
              >
                {showDetailedCalculation ? '隐藏详细计算' : '显示详细计算'}
              </button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
              <div>
                <p style={{ fontSize: '16px', margin: '8px 0' }}>
                  <strong>材料成本:</strong> <span style={{ color: '#d32f2f' }}>¥{quote.calculation.materialCost.toFixed(2)}</span>
                </p>
                <p style={{ fontSize: '16px', margin: '8px 0' }}>
                  <strong>人工成本:</strong> <span style={{ color: '#f57c00' }}>¥{quote.calculation.laborCost.toFixed(2)}</span>
                </p>
                <p style={{ fontSize: '16px', margin: '8px 0' }}>
                  <strong>设备费用:</strong> <span style={{ color: '#0288d1' }}>¥{quote.calculation.equipmentCost.toFixed(2)}</span>
                </p>
                <p style={{ fontSize: '16px', margin: '8px 0' }}>
                  <strong>管理费用:</strong> <span style={{ color: '#616161' }}>¥{quote.calculation.overheadCost.toFixed(2)}</span>
                </p>
                <p style={{ fontSize: '16px', margin: '8px 0' }}>
                  <strong>利润:</strong> <span style={{ color: '#388e3c' }}>¥{quote.calculation.profit.toFixed(2)}</span>
                </p>
              </div>
              <div style={{ textAlign: 'right', borderLeft: '2px solid #ccc', paddingLeft: '20px' }}>
                <p style={{ fontSize: '14px', color: '#666', margin: '4px 0' }}>单价: ¥{quote.calculation.unitPrice.toFixed(2)}</p>
                <p style={{ fontSize: '14px', color: '#666', margin: '4px 0' }}>数量: {quote.quantity}</p>
                <hr style={{ margin: '10px 0' }} />
                <p style={{ fontSize: '24px', fontWeight: 'bold', color: '#d32f2f', margin: 0 }}>
                  总价: ¥{quote.calculation.total.toFixed(2)}
                </p>
              </div>
            </div>
          </div>

          {/* 详细计算依据 */}
          {showDetailedCalculation && quote.calculation.breakdown && (
            <>
              {/* 体积和重量计算 */}
              <div style={{ backgroundColor: '#fff3e0', padding: '20px', marginBottom: '20px', borderRadius: '4px' }}>
                <h3>📐 体积与重量计算依据</h3>
                <div style={{ backgroundColor: 'white', padding: '15px', borderRadius: '4px', marginTop: '10px' }}>
                  <p><strong>形状类型:</strong> {quote.calculation.breakdown.volumeCalculation.type}</p>
                  <p><strong>尺寸参数:</strong> {quote.calculation.breakdown.volumeCalculation.dimensions}</p>
                  <p><strong>计算公式:</strong> <code style={{ backgroundColor: '#f5f5f5', padding: '2px 6px', borderRadius: '3px' }}>{quote.calculation.breakdown.volumeCalculation.formula}</code></p>
                  <p><strong>体积:</strong> {quote.calculation.breakdown.volume.toFixed(4)} cm³</p>
                  <p><strong>材料密度:</strong> {quote.calculation.breakdown.density} g/cm³</p>
                  <p><strong>重量:</strong> {quote.calculation.breakdown.weight.toFixed(3)} kg</p>
                </div>
              </div>

              {/* 材料成本计算 */}
              <div style={{ backgroundColor: '#e3f2fd', padding: '20px', marginBottom: '20px', borderRadius: '4px' }}>
                <h3>💰 材料成本计算</h3>
                <div style={{ backgroundColor: 'white', padding: '15px', borderRadius: '4px', marginTop: '10px' }}>
                  <p><strong>计算公式:</strong> <code style={{ backgroundColor: '#f5f5f5', padding: '2px 6px', borderRadius: '3px' }}>{quote.calculation.breakdown.materialCalculation.formula}</code></p>
                  <div style={{ marginTop: '15px', borderLeft: '3px solid #0288d1', paddingLeft: '15px' }}>
                    {quote.calculation.breakdown.materialCalculation.details.map((detail, index) => (
                      <p key={index} style={{ margin: '5px 0' }}>• {detail}</p>
                    ))}
                  </div>
                </div>
              </div>

              {/* 工序分解 */}
              {quote.calculation.breakdown.processBreakdown && (
                <div style={{ backgroundColor: '#e8f5e9', padding: '20px', marginBottom: '20px', borderRadius: '4px' }}>
                  <h3>⚙️ 工序分解与工时分析</h3>
                  <div style={{ marginTop: '10px' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', backgroundColor: 'white' }}>
                      <thead>
                        <tr style={{ backgroundColor: '#f5f5f5' }}>
                          <th style={{ padding: '12px', textAlign: 'left', borderBottom: '2px solid #ddd' }}>工序</th>
                          <th style={{ padding: '12px', textAlign: 'left', borderBottom: '2px solid #ddd' }}>预估工时</th>
                          <th style={{ padding: '12px', textAlign: 'left', borderBottom: '2px solid #ddd' }}>工时费率</th>
                          <th style={{ padding: '12px', textAlign: 'left', borderBottom: '2px solid #ddd' }}>人工成本</th>
                          <th style={{ padding: '12px', textAlign: 'left', borderBottom: '2px solid #ddd' }}>设备费用</th>
                        </tr>
                      </thead>
                      <tbody>
                        {quote.calculation.breakdown.processBreakdown.processes.map((process, index) => (
                          <tr key={index} style={{ borderBottom: '1px solid #eee' }}>
                            <td style={{ padding: '10px' }}>{process.name}</td>
                            <td style={{ padding: '10px' }}>{process.estimatedTime} 小时</td>
                            <td style={{ padding: '10px' }}>¥{process.hourlyRate}/小时</td>
                            <td style={{ padding: '10px' }}>¥{process.laborCost}</td>
                            <td style={{ padding: '10px' }}>¥{process.equipmentCost}</td>
                          </tr>
                        ))}
                        <tr style={{ backgroundColor: '#f9f9f9', fontWeight: 'bold' }}>
                          <td style={{ padding: '10px' }}>合计</td>
                          <td style={{ padding: '10px' }}>{quote.calculation.breakdown.processBreakdown.summary.totalTime} 小时</td>
                          <td style={{ padding: '10px' }}>-</td>
                          <td style={{ padding: '10px' }}>¥{quote.calculation.breakdown.processBreakdown.totalLaborCost.toFixed(2)}</td>
                          <td style={{ padding: '10px' }}>¥{quote.calculation.breakdown.processBreakdown.totalEquipmentCost.toFixed(2)}</td>
                        </tr>
                      </tbody>
                    </table>
                    <div style={{ marginTop: '15px', backgroundColor: '#f5f5f5', padding: '10px', borderRadius: '4px' }}>
                      <p style={{ margin: '5px 0' }}><strong>精度系数:</strong> {quote.calculation.breakdown.precisionFactor}x</p>
                      <p style={{ margin: '5px 0' }}><strong>说明:</strong> 精度要求越高，加工难度越大，工时和费用相应增加</p>
                    </div>
                  </div>
                </div>
              )}

              {/* 费用汇总 */}
              <div style={{ backgroundColor: '#fce4ec', padding: '20px', marginBottom: '20px', borderRadius: '4px' }}>
                <h3>📊 费用构成分析</h3>
                <div style={{ backgroundColor: 'white', padding: '15px', borderRadius: '4px', marginTop: '10px' }}>
                  <p><strong>管理费用:</strong> (材料成本 + 人工成本 + 设备费用) × 15%</p>
                  <p style={{ marginLeft: '20px' }}>
                    = (¥{(quote.calculation.materialCost/quote.quantity).toFixed(2)} + ¥{(quote.calculation.laborCost/quote.quantity).toFixed(2)} + ¥{(quote.calculation.equipmentCost/quote.quantity).toFixed(2)}) × 15%
                  </p>
                  <p style={{ marginLeft: '20px' }}>= ¥{(quote.calculation.overheadCost/quote.quantity).toFixed(2)} /件</p>

                  <p style={{ marginTop: '15px' }}><strong>利润:</strong> (材料成本 + 人工成本 + 设备费用 + 管理费用) × 20%</p>
                  <p style={{ marginLeft: '20px' }}>
                    = (¥{(quote.calculation.materialCost/quote.quantity).toFixed(2)} + ¥{(quote.calculation.laborCost/quote.quantity).toFixed(2)} + ¥{(quote.calculation.equipmentCost/quote.quantity).toFixed(2)} + ¥{(quote.calculation.overheadCost/quote.quantity).toFixed(2)}) × 20%
                  </p>
                  <p style={{ marginLeft: '20px' }}>= ¥{(quote.calculation.profit/quote.quantity).toFixed(2)} /件</p>
                </div>
              </div>
            </>
          )}
        </>
      ) : (
        <div style={{ marginBottom: '20px' }}>
          <button onClick={handleCalculate} style={{
            padding: '12px 24px',
            backgroundColor: '#007bff',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer',
            fontSize: '16px'
          }}>
            计算报价
          </button>
        </div>
      )}

      {quote.aiReview && (
        <div style={{ backgroundColor: '#fff3e0', padding: '20px', marginBottom: '20px', borderRadius: '4px' }}>
          <h3>AI审核结果</h3>
          <p><strong>状态:</strong> {quote.aiReview.status}</p>
          <p><strong>意见:</strong></p>
          <ul>
            {quote.aiReview.comments.map((c, i) => <li key={i}>{c}</li>)}
          </ul>
          {quote.aiReview.suggestions.length > 0 && (
            <>
              <p><strong>建议:</strong></p>
              <ul>
                {quote.aiReview.suggestions.map((s, i) => <li key={i}>{s}</li>)}
              </ul>
            </>
          )}
        </div>
      )}

      {quote.calculation && !quote.aiReview && (
        <div style={{ marginBottom: '20px' }}>
          <button onClick={handleAIReview} style={{
            padding: '12px 24px',
            backgroundColor: '#ff9800',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer',
            fontSize: '16px'
          }}>
            执行AI审核
          </button>
        </div>
      )}

      {quote.aiReview && !quote.manualReview && (
        <div style={{ backgroundColor: '#e3f2fd', padding: '20px', marginBottom: '20px', borderRadius: '4px' }}>
          <h3>人工审核</h3>
          <div style={{ marginBottom: '10px' }}>
            <label>审核结果:</label>
            <select
              value={reviewData.status}
              onChange={(e) => setReviewData({ ...reviewData, status: e.target.value })}
              style={{ marginLeft: '10px', padding: '5px' }}
            >
              <option value="approved">通过</option>
              <option value="rejected">拒绝</option>
              <option value="needs_modification">需修改</option>
            </select>
          </div>
          <div style={{ marginBottom: '10px' }}>
            <label>审核意见:</label>
            <textarea
              value={reviewData.comments}
              onChange={(e) => setReviewData({ ...reviewData, comments: e.target.value })}
              style={{ width: '100%', height: '80px', marginTop: '5px', padding: '8px' }}
            />
          </div>
          <button onClick={handleManualReview} style={{
            padding: '12px 24px',
            backgroundColor: '#4caf50',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer',
            fontSize: '16px'
          }}>
            提交审核
          </button>
        </div>
      )}

      {quote.manualReview && (
        <div style={{ backgroundColor: '#e8f5e9', padding: '20px', marginBottom: '20px', borderRadius: '4px' }}>
          <h3>人工审核</h3>
          <p><strong>状态:</strong> {quote.manualReview.status}</p>
          <p><strong>意见:</strong> {quote.manualReview.comments || '-'}</p>
        </div>
      )}

      {quote.manualReview && quote.manualReview.status === 'approved' && (
        <div>
          <button onClick={handleExport} style={{
            padding: '12px 24px',
            backgroundColor: '#9c27b0',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer',
            fontSize: '16px'
          }}>
            导出报价单 (PDF)
          </button>
        </div>
      )}
    </div>
  );
}

export default QuoteDetail;

