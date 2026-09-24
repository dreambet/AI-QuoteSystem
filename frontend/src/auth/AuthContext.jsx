import React, { createContext, useCallback, useEffect, useMemo, useState } from 'react';
import axios from 'axios';

const TOKEN_KEY = 'machining_quote_auth_token';
const USER_KEY = 'machining_quote_auth_user';
export const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [token, setToken] = useState(() => sessionStorage.getItem(TOKEN_KEY));
  const [user, setUser] = useState(() => {
    try { return JSON.parse(sessionStorage.getItem(USER_KEY) || 'null'); } catch (_) { return null; }
  });
  const [checking, setChecking] = useState(!!sessionStorage.getItem(TOKEN_KEY));

  const clearAuth = useCallback(() => {
    sessionStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(USER_KEY);
    sessionStorage.removeItem('machining-quote-ai-workbench');
    setToken(null);
    setUser(null);
  }, []);

  const login = useCallback(async (username, password) => {
    const response = await axios.post('/api/auth/login', { username, password });
    sessionStorage.setItem(TOKEN_KEY, response.data.token);
    sessionStorage.setItem(USER_KEY, JSON.stringify(response.data.user));
    setToken(response.data.token);
    setUser(response.data.user);
    return response.data.user;
  }, []);

  const logout = useCallback(async () => {
    try { await axios.post('/api/auth/logout'); } catch (_) { /* 本地仍应清理会话。 */ }
    clearAuth();
  }, [clearAuth]);

  useEffect(() => {
    const requestId = axios.interceptors.request.use(config => {
      const currentToken = sessionStorage.getItem(TOKEN_KEY);
      if (currentToken && config.url?.startsWith('/api/')) {
        config.headers = { ...(config.headers || {}), Authorization: `Bearer ${currentToken}` };
      }
      return config;
    });
    const responseId = axios.interceptors.response.use(
      response => response,
      error => {
        if (error.response?.status === 401 && !String(error.config?.url || '').startsWith('/api/auth/login')) clearAuth();
        return Promise.reject(error);
      }
    );
    return () => { axios.interceptors.request.eject(requestId); axios.interceptors.response.eject(responseId); };
  }, [clearAuth]);

  useEffect(() => {
    if (!token) { setChecking(false); return undefined; }
    let active = true;
    axios.get('/api/auth/me').then(response => {
      if (active) setUser(response.data.user);
    }).catch(() => clearAuth()).finally(() => { if (active) setChecking(false); });
    return () => { active = false; };
  }, [token, clearAuth]);

  const value = useMemo(() => ({ token, user, checking, login, logout, clearAuth }), [token, user, checking, login, logout, clearAuth]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
