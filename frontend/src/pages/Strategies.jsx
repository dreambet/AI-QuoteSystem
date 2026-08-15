import React, { useState, useEffect } from 'react';
import { catalogApi } from '../api/quotes';

// 7 个字段：5 个百分率（UI 显示百分数、存储小数）+ 样品倍率 + 调机费(金额)
const RATE_FIELDS = [
  { key: 'overheadRate', label: '管销率', step: '0.01', hint: '如 10 (即10%)', percent: true },
  { key: 'profitRate', label: '利润率', step: '0.01', hint: '如 30 (即30%)', percent: true },
  { key: 'taxRate', label: '税率', step: '0.01', hint: '如 13 (即13%)', percent: true },
  { key: 'sampleMultiplier', label: '样品倍率', step: '0.01', hint: '量产=1', percent: false },
  { key: 'materialLossRate', label: '材料损耗率', step: '0.01', hint: '如 5 (即5%)', percent: true },
  { key: 'toolLossRate', label: '刀具损耗率', step: '0.01', hint: '如 8 (即8%)', percent: true },
  { key: 'setupFeeDefault', label: '调机费(元)', step: '1', hint: '如 300', percent: false }
];

const emptyForm = {
  name: '', materialLossRate: '', toolLossRate: '', overheadRate: '',
  profitRate: '', taxRate: '', sampleMultiplier: '', setupFeeDefault: '', changeReason: ''
};

// 存储值(小数) <-> 显示值(百分率字段为百分数)。后端始终存小数，QuoteCalculator 用小数计算。
const toDisplay = (value, percent) => (value == null || value === '') ? '' : (percent ? Number(value) * 100 : Number(value));
const toStore = (value, percent) => (value === '' || value == null) ? undefined : (percent ? Number(value) / 100 : Number(value));
const fmt = (v, key) => {
  const percent = RATE_FIELDS.find(f => f.key === key)?.percent;
  return v == null ? '-' : (percent ? `${Number(v) * 100}%` : `${Number(v)}`);
};

const modalStyle = {
  position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)',
  background: '#fff', borderRadius: 12, padding: 24, width: '90%', maxWidth: 640,
  maxHeight: '85vh', overflow: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,0.3)', zIndex: 1001
};
const fieldLabelStyle = { display: 'block', fontSize: 13, color: '#666', marginBottom: 4 };
const inputStyle = { width: '100%', padding: '8px', borderRadius: 6, border: '1px solid #ddd', boxSizing: 'border-box' };

function Strategies() {
  const [strategies, setStrategies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState({ open: false, mode: 'create', editingId: null, form: { ...emptyForm } });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(null);

  const load = () => {
    setLoading(true);
    catalogApi.getStrategies()
      .then(r => setStrategies(r.data))
      .catch(() => setStrategies([]))
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  const openCreate = () => {
    setError('');
    setModal({ open: true, mode: 'create', editingId: null, form: { ...emptyForm, taxRate: '13', sampleMultiplier: '2', setupFeeDefault: '300' } });
  };
  const openEdit = (s) => {
    setError('');
    const f = { ...emptyForm, name: s.name || '', changeReason: '' };
    RATE_FIELDS.forEach(({ key, percent }) => { f[key] = toDisplay(s[key], percent); });
    setModal({ open: true, mode: 'edit', editingId: s.id, form: f });
  };
  const closeModal = () => setModal(m => ({ ...m, open: false }));
  const setField = (k, v) => setModal(m => ({ ...m, form: { ...m.form, [k]: v } }));

  const submit = async () => {
    const f = modal.form;
    if (!f.name.trim()) { setError('策略名称 name 必填'); return; }
    setSaving(true); setError('');
    try {
      const payload = {
        name: f.name.trim(),
        changeReason: f.changeReason.trim() || (modal.mode === 'create' ? '新建成本策略' : '策略维护')
      };
      RATE_FIELDS.forEach(({ key, percent }) => {
        const stored = toStore(f[key], percent);
        if (stored !== undefined) payload[key] = stored;
      });
      if (modal.mode === 'create') {
        await catalogApi.createStrategy(payload);
      } else {
        if (!modal.editingId) throw new Error('未找到原策略');
        await catalogApi.updateStrategy(modal.editingId, payload);
      }
      closeModal();
      load();
    } catch (e) {
      setError(e.response?.data?.error || e.message || '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (s) => {
    try {
      await catalogApi.deleteStrategy(s.id);
      setConfirmDelete(null);
      load();
    } catch (e) {
      setError(e.response?.data?.error || e.message || '删除失败');
      setConfirmDelete(null);
    }
  };

  return <div className="quote-center-page">
    <section className="quote-center-hero">
      <div><span className="eyebrow">PRICING STRATEGY / ADMIN</span><h1>成本策略</h1><p>维护报价策略的损耗率/管销/利润/税/样品倍率/调机费。</p></div>
      <div className="quote-center-actions"><button type="button" className="primary-action link-action" onClick={openCreate}>新建策略</button></div>
    </section>

    <section className="quote-table-card">
      <div className="quote-table-heading"><div><span className="eyebrow">STRATEGIES</span><h2>策略列表</h2></div><span>{loading ? '正在同步数据…' : `${strategies.length} 条策略`}</span></div>
      {loading ? <div className="console-empty">正在加载策略…</div> : strategies.length ? (
        <div className="quote-table-wrap"><table className="quote-table"><thead><tr><th>名称</th><th>管销率</th><th>利润率</th><th>税率</th><th>样品倍率</th><th>材料损耗</th><th>刀具损耗</th><th>调机费</th><th aria-label="操作" /></tr></thead>
          <tbody>{strategies.map(s => <tr key={s.id}>
            <td><strong>{s.name}</strong></td>
            <td>{fmt(s.overheadRate, 'overheadRate')}</td>
            <td>{fmt(s.profitRate, 'profitRate')}</td>
            <td>{fmt(s.taxRate, 'taxRate')}</td>
            <td>{fmt(s.sampleMultiplier, 'sampleMultiplier')}</td>
            <td>{fmt(s.materialLossRate, 'materialLossRate')}</td>
            <td>{fmt(s.toolLossRate, 'toolLossRate')}</td>
            <td>{fmt(s.setupFeeDefault, 'setupFeeDefault')}</td>
            <td>
              <button type="button" className="table-view-link" onClick={() => openEdit(s)}>编辑</button>
              <button type="button" className="table-view-link" style={{ marginLeft: 8, color: '#c62828' }} onClick={() => setConfirmDelete(s)}>删除</button>
            </td>
          </tr>)}</tbody>
        </table></div>
      ) : <div className="console-empty">暂无策略，点击"新建策略"创建。</div>}
    </section>

    {error && <div style={{ color: '#c62828', margin: '0 24px 12px' }}>{error}</div>}

    {modal.open && (
      <div className="trace-drawer-mask" onClick={closeModal}>
        <div style={modalStyle} onClick={e => e.stopPropagation()}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <h3 style={{ margin: 0 }}>{modal.mode === 'create' ? '新建成本策略' : '编辑策略'}</h3>
            <button type="button" onClick={closeModal} style={{ border: 'none', background: 'none', fontSize: 22, cursor: 'pointer', lineHeight: 1 }}>×</button>
          </div>
          <div style={{ display: 'grid', gap: 12 }}>
            <label>
              <span style={fieldLabelStyle}>策略名称 name（唯一）</span>
              <input value={modal.form.name} onChange={e => setField('name', e.target.value)} placeholder="如 成本策略F" style={inputStyle} />
            </label>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              {RATE_FIELDS.map(({ key, label, step, hint, percent }) => (
                <label key={key}>
                  <span style={fieldLabelStyle}>{label}{percent && ' (%)'}</span>
                  <input type="number" step={step} value={modal.form[key]} onChange={e => setField(key, e.target.value)} placeholder={hint} style={inputStyle} />
                </label>
              ))}
            </div>
            <label>
              <span style={fieldLabelStyle}>变更原因（选填）</span>
              <input value={modal.form.changeReason} onChange={e => setField('changeReason', e.target.value)} placeholder="如 新增量产产品策略" style={inputStyle} />
            </label>
            {error && <div style={{ color: '#c62828', fontSize: 13 }}>{error}</div>}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 4 }}>
              <button type="button" className="secondary-action" onClick={closeModal}>取消</button>
              <button type="button" className="primary-action" onClick={submit} disabled={saving}>{saving ? '保存中…' : '保存'}</button>
            </div>
          </div>
        </div>
      </div>
    )}

    {confirmDelete && (
      <div className="trace-drawer-mask" onClick={() => setConfirmDelete(null)}>
        <div style={{ ...modalStyle, maxWidth: 420 }} onClick={e => e.stopPropagation()}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <h3 style={{ margin: 0 }}>删除策略</h3>
            <button type="button" onClick={() => setConfirmDelete(null)} style={{ border: 'none', background: 'none', fontSize: 22, cursor: 'pointer', lineHeight: 1 }}>×</button>
          </div>
          <p>确定删除 <strong>{confirmDelete.name}</strong> 吗？</p>
          <p style={{ color: '#666', fontSize: 13, marginTop: 8 }}>已有报价的 processSnapshot 存了完整率值快照，删除策略不影响历史报价的重算与展示。</p>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
            <button type="button" className="secondary-action" onClick={() => setConfirmDelete(null)}>取消</button>
            <button type="button" className="primary-action" onClick={() => remove(confirmDelete)}>确认删除</button>
          </div>
        </div>
      </div>
    )}
  </div>;
}

export default Strategies;
