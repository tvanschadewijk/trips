import { marked } from 'marked';

/**
 * Render trip markdown_source to HTML for the detail sheet.
 *
 * The markdown comes from authenticated trip owners (via the skill or
 * the chat editor) but is then displayed to anyone with the public
 * share URL. We sanitize a small set of dangerous patterns so a
 * malicious owner can't pop a script in someone else's browser.
 *
 * For full XSS coverage we'd add DOMPurify; this lightweight pass
 * covers the obvious vectors without a new dependency.
 */

function sanitize(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, '')
    .replace(/\son[a-z]+\s*=\s*"[^"]*"/gi, '')
    .replace(/\son[a-z]+\s*=\s*'[^']*'/gi, '')
    .replace(/\son[a-z]+\s*=\s*[^\s>]+/gi, '')
    .replace(/href\s*=\s*("|')\s*javascript:[^"']*("|')/gi, 'href="#"')
    .replace(/src\s*=\s*("|')\s*javascript:[^"']*("|')/gi, '');
}

export function renderTripMarkdown(source: string): string {
  if (!source.trim()) {
    return '<p class="markdown-empty">No source content available.</p>';
  }
  const raw = marked.parse(source, {
    breaks: true,
    gfm: true,
    async: false,
  }) as string;
  return `<div class="markdown-body">${sanitize(raw)}</div>`;
}
