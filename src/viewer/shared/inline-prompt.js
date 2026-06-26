import { h } from '../core/template.js';

// Lightweight replacement for window.prompt(): a themed, Promise-based modal
// input. Returns the entered string, or null if cancelled (Esc / backdrop /
// Cancel). prompt() is synchronous, blocking, and suppressed by some corporate
// browser hardening — this is none of those.
export function inlinePrompt({ title = '', value = '', placeholder = '', okLabel = 'OK' } = {}) {
  return new Promise(resolve => {
    let settled = false;
    const finish = v => {
      if (settled) return;
      settled = true;
      document.removeEventListener('keydown', onKey, true);
      overlay.remove();
      resolve(v);
    };

    const input = h('input', {
      type: 'text',
      value,
      placeholder,
      class: 'inline-prompt-input',
      style:
        'width:100%;box-sizing:border-box;padding:8px 10px;border-radius:6px;' +
        'border:1px solid var(--border);background:var(--bg);color:var(--text);font:inherit;',
    });

    const btnBase =
      'padding:7px 14px;border-radius:6px;font:inherit;cursor:pointer;border:1px solid var(--border);';
    const cancelBtn = h(
      'button',
      { style: btnBase + 'background:transparent;color:var(--text);', onClick: () => finish(null) },
      'Cancel'
    );
    const okBtn = h(
      'button',
      {
        style:
          btnBase + 'background:var(--accent);color:var(--sn-deep);border-color:var(--accent);',
        onClick: () => finish(input.value),
      },
      okLabel
    );

    const box = h(
      'div',
      {
        style:
          'min-width:320px;max-width:90vw;background:var(--panel);border:1px solid var(--border);' +
          'border-radius:10px;padding:16px;box-shadow:0 12px 40px rgba(0,0,0,.5);',
        onClick: e => e.stopPropagation(),
      },
      title
        ? h('div', { style: 'font-weight:600;margin-bottom:10px;color:var(--text);' }, title)
        : null,
      input,
      h(
        'div',
        { style: 'display:flex;gap:8px;justify-content:flex-end;margin-top:14px;' },
        cancelBtn,
        okBtn
      )
    );

    const overlay = h(
      'div',
      {
        class: 'inline-prompt-overlay',
        style:
          'position:fixed;inset:0;z-index:9999;display:flex;align-items:center;' +
          'justify-content:center;background:rgba(0,0,0,.45);',
        onClick: () => finish(null),
      },
      box
    );

    function onKey(e) {
      if (e.key === 'Escape') {
        e.preventDefault();
        finish(null);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        finish(input.value);
      }
    }

    document.addEventListener('keydown', onKey, true);
    document.body.appendChild(overlay);
    input.focus();
    input.select();
  });
}
