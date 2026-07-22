
import React from 'react';
import { BrowserRouter as Router, Routes, Route, Link } from 'react-router-dom';
import './App.css';

function App() {
  return (
    &lt;Router&gt;
      &lt;div className="App"&gt;
        &lt;header className="App-header"&gt;
          &lt;h1&gt;机加工报价系统&lt;/h1&gt;
          &lt;nav style={{ marginTop: '10px' }}&gt;
            &lt;Link to="/" style={{ color: 'white', marginRight: '20px' }}&gt;首页&lt;/Link&gt;
            &lt;Link to="/quotes/new" style={{ color: 'white' }}&gt;新建报价&lt;/Link&gt;
          &lt;/nav&gt;
        &lt;/header&gt;
        &lt;main&gt;
          &lt;Routes&gt;
            &lt;Route path="/" element={&lt;div&gt;&lt;h2&gt;欢迎使用机加工报价系统&lt;/h2&gt;&lt;/div&gt;} /&gt;
            &lt;Route path="/quotes/new" element={&lt;div&gt;&lt;h2&gt;新建报价表单&lt;/h2&gt;&lt;/div&gt;} /&gt;
          &lt;/Routes&gt;
        &lt;/main&gt;
      &lt;/div&gt;
    &lt;/Router&gt;
  );
}

export default App;

