import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { quoteApi, uploadApi } from '../api/quotes';

function FormField({ label, children }) { return <label className="console-field"><span>{label}</span>{children}</label>; }

function QuoteForm() {
  const navigate = useNavigate();
  const [formData, setFormData] = useState({ partName: '', partNumber: '', material: '钢材', length: '', width: '', height: '', diameter: '', quantity: 1, deliveryDate: '', precision: '中等' });
  const [selectedFile, setSelectedFile] = useState(null);
  const [uploadedPath, setUploadedPath] = useState(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const change = event => setFormData(data => ({ ...data, [event.target.name]: event.target.value }));
  const upload = async () => {
    if (!selectedFile) return;
    setLoading(true); setMessage('');
    try { const response = await uploadApi.uploadDrawing(selectedFile); setUploadedPath(response.data.filename); setMessage('图纸已上传，可创建报价。'); } catch (error) { setMessage(`上传失败：${error.message}`); } finally { setLoading(false); }
  };
  const submit = async event => {
    event.preventDefault(); setLoading(true); setMessage('');
    try { const response = await quoteApi.create({ ...formData, drawingPath: uploadedPath }); navigate(`/quotes/${response.data.id}`); } catch (error) { setMessage(`创建失败：${error.message}`); setLoading(false); }
  };
  return <div className="basic-quote-page"><header className="basic-quote-hero"><div><Link className="back-link" to="/quotes">← 返回报价中心</Link><span className="eyebrow">MANUAL QUOTATION / QUICK INTAKE</span><h1>新建基础报价</h1><p>适用于已明确零件参数的快速报价任务；需要图纸智能识别时可转至 AI 工作台。</p></div><Link className="secondary-action link-action" to="/quotes/ai-new">使用 AI 图纸分析</Link></header><form className="basic-quote-layout" onSubmit={submit}><section className="parameter-console basic-form-card"><div className="mini-panel-title"><span>零件与工艺参数</span><b>必填项已标记</b></div><div className="basic-form-grid"><FormField label="零件名称 *"><input required name="partName" value={formData.partName} onChange={change} /></FormField><FormField label="零件编号"><input name="partNumber" value={formData.partNumber} onChange={change} /></FormField><FormField label="材料 *"><select name="material" value={formData.material} onChange={change}><option value="钢材">钢材</option><option value="铝材">铝材</option><option value="铜材">铜材</option><option value="不锈钢">不锈钢</option></select></FormField><FormField label="精度要求"><select name="precision" value={formData.precision} onChange={change}><option value="低">低</option><option value="中等">中等</option><option value="高">高</option><option value="极高">极高</option></select></FormField><FormField label="长度 (mm)"><input type="number" name="length" value={formData.length} onChange={change} /></FormField><FormField label="宽度 (mm)"><input type="number" name="width" value={formData.width} onChange={change} /></FormField><FormField label="高度 (mm)"><input type="number" name="height" value={formData.height} onChange={change} /></FormField><FormField label="直径 (mm)"><input type="number" name="diameter" value={formData.diameter} onChange={change} /></FormField><FormField label="数量 *"><input required min="1" type="number" name="quantity" value={formData.quantity} onChange={change} /></FormField><FormField label="交货期"><input type="date" name="deliveryDate" value={formData.deliveryDate} onChange={change} /></FormField></div><div className="workspace-actions"><button disabled={loading} className="primary-action" type="submit">{loading ? '正在创建…' : '创建报价任务'}</button></div></section><aside className="basic-upload-card"><span className="eyebrow">OPTIONAL DRAWING</span><h2>关联图纸</h2><p>上传后可在报价详情中保留图纸记录。若需自动识别，请使用 AI 工作台。</p><label className="upload-select"><span>{selectedFile ? selectedFile.name : '选择图纸文件'}</span><input type="file" accept=".pdf,.png,.jpg,.jpeg,.dwg,.dxf,.step,.stp" onChange={event => { setSelectedFile(event.target.files?.[0] || null); setUploadedPath(null); setMessage(''); }} /></label><small>支持 DWG、DXF、STEP、STP、PDF 与图片</small>{selectedFile && !uploadedPath && <button type="button" className="secondary-action" disabled={loading} onClick={upload}>{loading ? '上传中…' : '上传图纸'}</button>}{uploadedPath && <div className="upload-success">✓ 图纸已成功关联</div>}{message && <p className="form-message">{message}</p>}</aside></form></div>;
}

export default QuoteForm;
