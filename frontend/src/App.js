
import React, { useContext, useState } from 'react';
import axios from 'axios';
import { BrowserRouter as Router, Routes, Route, Link, Navigate, useLocation } from 'react-router-dom';
import Strategies from './pages/Strategies';
import QuoteList from './pages/QuoteList';
import QuoteDetail from './pages/QuoteDetail.jsx';
import AIQuoteCreation from './pages/AIQuoteCreation.jsx';
import AssistantChat from './components/AssistantChat.jsx';
import Login from './pages/Login.jsx';
import { AuthContext } from './auth/AuthContext';
import './App.css';

function ProtectedApp() {
  const { user, checking, logout } = useContext(AuthContext);
  const location = useLocation();
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [passwords, setPasswords] = useState({ currentPassword: '', newPassword: '' });
  const [passwordError, setPasswordError] = useState('');
  const [savingPassword, setSavingPassword] = useState(false);
  if (checking) return <div className="app-auth-loading">正在验证登录状态…</div>;
  if (!user) return <Navigate to="/login" replace state={{ from: location }} />;
  const changePassword = async event => {
    event.preventDefault();
    setSavingPassword(true); setPasswordError('');
    try {
      await axios.put('/api/auth/password', passwords);
      await logout();
    } catch (error) {
      setPasswordError(error.response?.data?.error || '密码更新失败，请稍后重试。');
    } finally { setSavingPassword(false); }
  };
  return (
      <div className="App">
        <header className="App-header">
          <Link className="brand-lockup" to="/"><span className="brand-mark">MC</span><span><strong>Machining Console</strong><small>INTELLIGENT QUOTATION</small></span></Link>
          <nav className="app-navigation">
            <Link to="/">报价中心</Link>
            <Link className="nav-ai-link" to="/quotes/ai-new">AI 分析工作台</Link>
            <Link className="nav-new-link" to="/strategies">成本策略</Link>
            <span className="account-name">管理员 · {user.username}</span>
            <button type="button" className="logout-button" onClick={() => setPasswordOpen(true)}>修改密码</button>
            <button type="button" className="logout-button" onClick={logout}>退出</button>
          </nav>
        </header>
        <main>
          <Routes>
            <Route path="/" element={<QuoteList />} />
            <Route path="/quotes" element={<QuoteList />} />
            <Route path="/strategies" element={<Strategies />} />
            <Route path="/quotes/ai-new" element={<AIQuoteCreation />} />
            <Route path="/quotes/:id" element={<QuoteDetail />} />
          </Routes>
        </main>
        <AssistantChat />
        {passwordOpen && <div className="account-modal-mask" onClick={() => setPasswordOpen(false)}><form className="account-modal" onSubmit={changePassword} onClick={event => event.stopPropagation()}><div><span className="eyebrow">ACCOUNT SECURITY</span><h2>修改管理员密码</h2><p>保存后会退出当前登录，需要使用新密码重新进入系统。</p></div><label>当前密码<input type="password" autoComplete="current-password" value={passwords.currentPassword} onChange={event => setPasswords(data => ({ ...data, currentPassword: event.target.value }))} required /></label><label>新密码<input type="password" autoComplete="new-password" value={passwords.newPassword} onChange={event => setPasswords(data => ({ ...data, newPassword: event.target.value }))} required /></label>{passwordError && <div className="login-error">{passwordError}</div>}<div className="account-modal-actions"><button type="button" className="secondary-action" onClick={() => setPasswordOpen(false)}>取消</button><button type="submit" className="primary-action" disabled={savingPassword}>{savingPassword ? '正在保存…' : '保存并退出'}</button></div></form></div>}
      </div>
  );
}

function App() {
  return <Router future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><Routes><Route path="/login" element={<Login />} /><Route path="*" element={<ProtectedApp />} /></Routes></Router>;
}

export default App;
