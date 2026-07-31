
import React from 'react';
import { BrowserRouter as Router, Routes, Route, Link } from 'react-router-dom';
import QuoteForm from './pages/QuoteForm';
import QuoteList from './pages/QuoteList';
import QuoteDetail from './pages/QuoteDetail.jsx';
import AIQuoteCreation from './pages/AIQuoteCreation.jsx';
import AssistantChat from './components/AssistantChat.jsx';
import './App.css';

function App() {
  return (
    <Router>
      <div className="App">
        <header className="App-header">
          <Link className="brand-lockup" to="/"><span className="brand-mark">MC</span><span><strong>Machining Console</strong><small>INTELLIGENT QUOTATION</small></span></Link>
          <nav className="app-navigation">
            <Link to="/">报价中心</Link>
            <Link className="nav-ai-link" to="/quotes/ai-new">AI 分析工作台</Link>
            <Link className="nav-new-link" to="/quotes/new">新建报价</Link>
          </nav>
        </header>
        <main>
          <Routes>
            <Route path="/" element={<QuoteList />} />
            <Route path="/quotes" element={<QuoteList />} />
            <Route path="/quotes/new" element={<QuoteForm />} />
            <Route path="/quotes/ai-new" element={<AIQuoteCreation />} />
            <Route path="/quotes/:id" element={<QuoteDetail />} />
          </Routes>
        </main>
        <AssistantChat />
      </div>
    </Router>
  );
}

export default App;
