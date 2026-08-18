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

function Strategies() {
  const [strategies, setStrategies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState({ open: false, mode: 'create', editingId: null, form: { ...emptyForm } });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);

  const load = () => {
    setLoading(true);
    catalogApi.getStrategies()
      .then(r => setStrategies(r.data))
      .catch(() => setStrategies([]))
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  const anyModalOpen = modal.open || !!confirmDelete;

  // 弹窗打开时锁定背景滚动 + Esc 关闭
  useEffect(() => {
    if (!anyModalOpen) return;
    document.body.style.overflow = 'hidden';
    const onKey = (e) => {
      if (e.key === 'Escape') {
        if (saving || deleting) return;
        setConfirmDelete(null);
        setModal(m => ({ ...m, open: false }));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => { document.body.style.overflow = ''; window.removeEventListener('keydown', onKey); };
  }, [anyModalOpen, saving, deleting]);

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
  const closeModal = () => { if (saving) return; setModal(m => ({ ...m, open: false })); };
  const setField = (k, v) => setModal(m => ({ ...m, form: { ...m.form, [k]: v } }));

  const submit = async (e) => {
    e.preventDefault();
    const f = modal.form;
    if (!f.name.trim()) { setError('策略名称必填，且需与现有策略不重复'); return; }
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
      setModal(m => ({ ...m, open: false }));
      load();
    } catch (err) {
      setError(err.response?.data?.error || err.message || '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (s) => {
    setDeleting(true);
    try {
      await catalogApi.deleteStrategy(s.id);
      setConfirmDelete(null);
      load();
    } catch (e) {
      setError(e.response?.data?.error || e.message || '删除失败');
      setConfirmDelete(null);
    } finally {
      setDeleting(false);
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
              <div className="table-action-group">
                <button type="button" className="table-action-btn" onClick={() => openEdit(s)}>✎ 编辑</button>
                <button type="button" className="table-action-btn table-action-danger" onClick={() => setConfirmDelete(s)}>✕ 删除</button>
              </div>
            </td>
          </tr>)}</tbody>
        </table></div>
      ) : <div className="console-empty">暂无策略，点击"新建策略"创建。</div>}
    </section>

    {error && !modal.open && !confirmDelete && (
      <div className="console-error" style={{ margin: '0 24px 12px' }}>{error}<button type="button" onClick={() => setError(null)}>×</button></div>
    )}

    {modal.open && (
      <div className="console-modal-mask" onClick={closeModal}>
        <form className="console-modal strategy-modal" onClick={e => e.stopPropagation()} onSubmit={submit}>
          <div className="console-modal-head">
            <div>
              <span>{modal.mode === 'create' ? '新建成本策略' : `编辑策略 · ${modal.form.name || ''}`}</span>
              <small>名称唯一；百分率按百分数填写（如 10 即 10%），保存时自动转小数存储，直接参与报价计算</small>
            </div>
            <button type="button" onClick={closeModal} aria-label="关闭">×</button>
          </div>
          <div className="console-modal-body">
            <div className="strategy-form">
              <label className="strategy-form-name">策略名称（唯一）
                <input autoFocus value={modal.form.name} onChange={e => setField('name', e.target.value)} placeholder="如 成本策略F" maxLength={50} />
              </label>
              <div className="strategy-form-grid">
                {RATE_FIELDS.map(({ key, label, step, hint, percent }) => (
                  <label key={key}>{label}{percent ? ' (%)' : ''}
                    <input type="number" step={step} value={modal.form[key]} onChange={e => setField(key, e.target.value)} placeholder={hint} />
                  </label>
                ))}
              </div>
              <label className="strategy-form-name">变更原因（选填）
                <input value={modal.form.changeReason} onChange={e => setField('changeReason', e.target.value)} placeholder={modal.mode === 'create' ? '如 新增量产产品策略' : '如 4月起管销率下调'} maxLength={100} />
              </label>
              {error && <p className="strategy-form-error">{error}</p>}
            </div>
          </div>
          <div className="console-modal-foot">
            <span className="console-modal-hint">{modal.mode === 'create' ? '保存后即可在报价工作台第3步选用' : '修改将记录变更原因；历史报价按率值快照不受影响'}</span>
            <div className="console-modal-ops">
              <button type="button" className="secondary-action" onClick={closeModal}>取消</button>
              <button type="submit" className="primary-action" disabled={saving}>{saving ? '保存中…' : '保存'}</button>
            </div>
          </div>
        </form>
      </div>
    )}

    {confirmDelete && (
      <div className="console-modal-mask" onClick={() => !deleting && setConfirmDelete(null)}>
        <div className="console-modal strategy-modal strategy-confirm" onClick={e => e.stopPropagation()}>
          <div className="console-modal-head">
            <div><span>删除策略</span><small>此操作不可撤销，请确认后继续</small></div>
            <button type="button" onClick={() => !deleting && setConfirmDelete(null)} aria-label="关闭">×</button>
          </div>
          <div className="console-modal-body strategy-confirm-body">
            <p>确定删除策略 <strong>{confirmDelete.name}</strong> 吗？</p>
            <p className="strategy-confirm-note">已有报价的成本策略不影响历史报价的重算与展示；但进行中的报价若未选中该策略以外的策略，计算时将回退到剩余策略中的第一条。</p>
          </div>
          <div className="console-modal-foot">
            <span className="console-modal-hint">如策略仍在使用，建议先在报价工作台确认依赖</span>
            <div className="console-modal-ops">
              <button type="button" className="secondary-action" disabled={deleting} onClick={() => setConfirmDelete(null)}>取消</button>
              <button type="button" className="danger-action" disabled={deleting} onClick={() => remove(confirmDelete)}>{deleting ? '删除中…' : '确认删除'}</button>
            </div>
          </div>
        </div>
      </div>
    )}
  </div>;
}

export default Strategies;
