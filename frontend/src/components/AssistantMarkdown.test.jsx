import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import AssistantMarkdown from './AssistantMarkdown.jsx';

const renderContent = content => {
  const element = document.createElement('div');
  element.innerHTML = renderToStaticMarkup(<AssistantMarkdown content={content} />);
  return element;
};

test('renders reply headings, emphasis, nested lists, tables and code', () => {
  const result = renderContent('# 操作说明\n\n1. **上传图纸**\n   - STEP 文件\n\n| 工序 | 分钟 |\n| --- | --- |\n| 铣削 | 15 |\n\n```js\nconst cost = 15;\n```');
  expect(result.querySelector('h1').textContent).toBe('操作说明');
  expect(result.querySelector('strong').textContent).toBe('上传图纸');
  expect(result.querySelector('ol li ul li').textContent).toBe('STEP 文件');
  expect(result.querySelector('.assistant-table-scroll table td').textContent).toBe('铣削');
  expect(result.querySelector('pre code').textContent).toContain('const cost = 15;');
});

test('handles partial streamed markup and formats it when completed', () => {
  expect(renderContent('请**确认').textContent).toContain('确认');
  expect(renderContent('请**确认参数**再报价').querySelector('strong').textContent).toBe('确认参数');
  expect(renderContent('```js\nconst value =').querySelector('pre code').textContent).toContain('const value =');
});

test('blocks raw HTML, unsafe links and remote images while keeping safe links', () => {
  const result = renderContent('<script>alert(1)</script>\n\n<img src="x" onerror="alert(1)">\n\n[危险](javascript:alert%281%29) [文档](https://example.com)\n\n![外部图片](https://example.com/track.png)');
  expect(result.querySelector('script, img, [onerror]')).toBeNull();
  const links = result.querySelectorAll('a');
  expect(links).toHaveLength(1);
  expect(links[0].getAttribute('href')).toBe('https://example.com');
  expect(links[0].getAttribute('rel')).toBe('noopener noreferrer');
});
