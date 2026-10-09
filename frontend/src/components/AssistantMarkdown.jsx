import React, { memo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import './AssistantMarkdown.css';

const remarkPlugins = [remarkGfm];
const components = {
  a: ({ href, children, title }) => href
    ? <a href={href} title={title} target="_blank" rel="noopener noreferrer">{children}</a>
    : <span>{children}</span>,
  table: ({ children }) => (
    <div className="assistant-table-scroll" tabIndex={0} role="region" aria-label="回复表格">
      <table>{children}</table>
    </div>
  ),
  // Knowledge-base replies should not load arbitrary remote images.
  img: ({ alt }) => alt ? <span>{alt}</span> : null
};

function AssistantMarkdown({ content }) {
  return (
    <div className="assistant-markdown">
      <ReactMarkdown remarkPlugins={remarkPlugins} components={components} skipHtml>
        {content}
      </ReactMarkdown>
    </div>
  );
}

export default memo(AssistantMarkdown);
