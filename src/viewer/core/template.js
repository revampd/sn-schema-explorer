const Template = (() => {
  function h(tag, props, ...children) {
    const el = document.createElement(tag);
    if (props) {
      for (const [k, v] of Object.entries(props)) {
        if (v == null) continue;
        if (k === 'class')      el.className = v;
        else if (k === 'style') {
          if (typeof v === 'string') el.style.cssText = v;
          else Object.assign(el.style, v);
        }
        else if (k.startsWith('data') && k.length > 4) {
          const name = k.slice(4).replace(/[A-Z]/g, m => '-' + m.toLowerCase()).replace(/^-/, '');
          el.setAttribute('data-' + name, v);
        }
        else if (k.startsWith('on') && typeof v === 'function') {
          el.addEventListener(k.slice(2).toLowerCase(), v);
        }
        else el.setAttribute(k, v);
      }
    }
    const append = c => {
      if (c == null || c === false) return;
      if (Array.isArray(c)) c.forEach(append);
      else if (c instanceof Node) el.appendChild(c);
      else el.appendChild(document.createTextNode(String(c)));
    };
    children.forEach(append);
    return el;
  }
  return { h };
})();

export const h = Template.h;
