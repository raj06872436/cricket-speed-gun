type Attrs = Record<string, string | number | boolean | EventListener | undefined | null>;
type Child = Node | string | number | null | undefined | false;

/** Tiny element builder: h('button.primary', { onclick }, 'Go'). */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K | `${K}.${string}` | `${K}#${string}`,
  attrs: Attrs = {},
  ...children: (Child | Child[])[]
): HTMLElementTagNameMap[K] {
  const [base, ...rest] = tag.split('.');
  const [name, id] = base.split('#');
  const el = document.createElement(name as K);
  if (id) el.id = id;
  if (rest.length) el.className = rest.join(' ');
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v as EventListener);
    else if (k === 'class') el.className += (el.className ? ' ' : '') + v;
    else if (k === 'html') el.innerHTML = String(v);
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, String(v));
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export function svg(tag: string, attrs: Record<string, string | number> = {}, ...children: (SVGElement | string)[]): SVGElement {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  for (const c of children) el.append(typeof c === 'string' ? document.createTextNode(c) : c);
  return el;
}

let toastTimer = 0;
export function toast(msg: string): void {
  let el = document.getElementById('toast');
  if (!el) {
    el = h('div#toast', { role: 'status', 'aria-live': 'polite' });
    document.body.append(el);
  }
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => el!.classList.remove('show'), 2600);
}

export function chips<T extends string | number>(
  options: { value: T; label: string; hint?: string }[],
  value: T,
  onChange: (v: T) => void,
  label: string,
): HTMLElement {
  const wrap = h('div.chips', { role: 'radiogroup', 'aria-label': label });
  const render = (cur: T) => {
    wrap.replaceChildren(
      ...options.map((o) =>
        h(
          'button.chip',
          {
            type: 'button',
            role: 'radio',
            'aria-checked': String(o.value === cur),
            class: o.value === cur ? 'on' : '',
            title: o.hint,
            onclick: () => {
              render(o.value);
              onChange(o.value);
            },
          },
          o.label,
        ),
      ),
    );
  };
  render(value);
  return wrap;
}
