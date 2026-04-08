'use client';

import { useEffect } from 'react';

/**
 * Client component that finds code blocks with class "language-copy"
 * (rendered from ```copy blocks in markdown) and adds a copy button.
 */
export default function CopyCodeBlocks() {
  useEffect(() => {
    const codeBlocks = document.querySelectorAll<HTMLElement>(
      '.blog-article-body pre code.language-copy'
    );

    codeBlocks.forEach((code) => {
      const pre = code.parentElement;
      if (!pre || pre.querySelector('.copy-btn')) return;

      pre.style.position = 'relative';

      const btn = document.createElement('button');
      btn.className = 'copy-btn';
      btn.textContent = 'Copy';
      btn.setAttribute('aria-label', 'Copy to clipboard');

      btn.addEventListener('click', async () => {
        const text = code.textContent?.trim() ?? '';
        try {
          await navigator.clipboard.writeText(text);
          btn.textContent = 'Copied!';
          btn.classList.add('copy-btn-copied');
          setTimeout(() => {
            btn.textContent = 'Copy';
            btn.classList.remove('copy-btn-copied');
          }, 2000);
        } catch {
          btn.textContent = 'Failed';
          setTimeout(() => {
            btn.textContent = 'Copy';
          }, 2000);
        }
      });

      pre.appendChild(btn);
    });
  }, []);

  return null;
}
