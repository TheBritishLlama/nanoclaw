import { describe, it, expect } from 'vitest';
import { extractReadable } from '../../../src/stack/pipeline/reader.js';

describe('extractReadable', () => {
  it('extracts the article body from a typical news-style HTML page', () => {
    const html = `<!DOCTYPE html><html><head><title>Test</title></head>
      <body>
        <nav>nav nav nav</nav>
        <article>
          <h1>Hello World</h1>
          <p>This is a long enough paragraph to satisfy Readability's minimum content heuristic, which discards tiny snippets that look like navigation or boilerplate. Lorem ipsum dolor sit amet, consectetur adipiscing elit.</p>
          <p>Here is a second paragraph with more substantive content so the article passes the length threshold.</p>
        </article>
        <footer>footer</footer>
      </body></html>`;
    const out = extractReadable(html, 'https://example.com/post');
    expect(out).not.toBeNull();
    expect(out!.textContent).toContain('Hello World');
    expect(out!.textContent).toContain('Lorem ipsum');
    expect(out!.textContent).not.toContain('nav nav nav');
    expect(out!.length).toBeGreaterThan(100);
  });

  it('returns null when input is not parseable / has no article-like content', () => {
    const out = extractReadable('<html><body></body></html>', 'https://example.com/');
    expect(out).toBeNull();
  });

  it('returns null when extracted text is shorter than 200 chars', () => {
    const html = '<html><body><article><p>tiny</p></article></body></html>';
    const out = extractReadable(html, 'https://example.com/');
    expect(out).toBeNull();
  });
});
