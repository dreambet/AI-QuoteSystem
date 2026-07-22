
import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { quoteApi, uploadApi } from '../api/quotes';

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
  const [selectedFile, setSelectedFile] = useState(null);
  const [uploadedPath, setUploadedPath] = useState(null);

  const handleChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const handleFileChange = (e) => {
    setSelectedFile(e.target.files[0]);
  };

  const handleFileUpload = async () => {
    if (!selectedFile) return;
    try {
      const response = await uploadApi.uploadDrawing(selectedFile);
      setUploadedPath(response.data.filename);
      alert('上传成功!');
    } catch (error) {
      alert('上传失败: ' + error.message);
    }
  };

  const handleSubmit = async (e) => {
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

        &lt;div style={{ marginBottom: '20px' }}&gt;
          &lt;label&gt;图纸上传&lt;/label&gt;
          &lt;div style={{ marginTop: '10px' }}&gt;
            &lt;input type="file" onChange={handleFileChange} accept=".pdf,.png,.jpg,.jpeg,.dxf" /&gt;
            {selectedFile &amp;&amp; !uploadedPath &amp;&amp; (
              &lt;button
                onClick={handleFileUpload}
                type="button"
                style={{ marginLeft: '10px', padding: '8px 16px' }}
              &gt;
                上传
              &lt;/button&gt;
            )}
            {uploadedPath &amp;&amp; (
              &lt;p style={{ color: 'green', marginTop: '5px' }}&gt;✓ 已上传&lt;/p&gt;
            )}
          &lt;/div&gt;
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

