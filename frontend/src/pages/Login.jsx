import React, { useContext, useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { AuthContext } from '../auth/AuthContext';

function Login() {
  const { user, login } = useContext(AuthContext);
  const location = useLocation();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const from = location.state?.from?.pathname || '/';
  if (user) return <Navigate to={from} replace />;

  const submit = async event => {
    event.preventDefault();
    setLoading(true); setError('');
    try { await login(username, password); } catch (requestError) { setError(requestError.response?.data?.error || '暂时无法登录，请稍后重试。'); } finally { setLoading(false); }
  };
  return <main className="login-page"><section className="login-card"><div className="login-brand"><span className="brand-mark">MC</span><div><strong>Machining Console</strong><small>INTELLIGENT QUOTATION</small></div></div><div className="login-copy"><span className="eyebrow">SECURE ACCESS</span><h1>管理员登录</h1><p>登录后可管理图纸解析、报价任务与成本参数。</p></div><form onSubmit={submit}><label>管理员账号<input autoComplete="username" value={username} onChange={event => setUsername(event.target.value)} placeholder="请输入管理员账号" required /></label><label>密码<input type="password" autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)} placeholder="请输入密码" required /></label>{error && <div className="login-error">{error}</div>}<button className="primary-action login-submit" type="submit" disabled={loading}>{loading ? '正在验证…' : '登录系统'}</button></form><p className="login-hint">首次部署请由系统管理员在服务端配置初始管理员账号和密码。</p></section></main>;
}

export default Login;
