// Compiles design/template.html (the x-dc template language) into a React render
// function: src/generated/template.tsx, plus src/generated/pseudo.css.
//
// The output reproduces the DOM the design runtime produced at render time,
// node for node, so the app looks identical to the delivered prototype:
//   {{ expr }}            text → <span class="sc-interp">…</span> (same as the runtime)
//   attr="{{ expr }}"     raw value; mixed strings interpolate with `?? ''`
//   style="…"             parsed into a React style object (same splitter as the runtime)
//   <sc-if value>         truthy check
//   <sc-for list as>      maps over an array with { ...scope, [as]: item, $index }
//   style-hover="…"       generated class with !important rules (pseudo.css)
//   sc-camel-foo-bar      fooBar prop;  <sc-raw-x> → <x>
//
// Expression grammar matches the runtime exactly: paths (a.b[c].0), ===/!==/==/!=,
// leading !, parentheses, and literals. Anything else is a compile error.
//
// Production changes to the delivered design are applied as explicit, checked
// patches from design/overrides.mjs before compiling.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseFragment } from 'parse5';
import { overrides, logicOverrides } from '../design/overrides.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let html = readFileSync(join(root, 'design/template.html'), 'utf8');

function applyOverrides(text, list) {
  for (const o of list) {
    const n = text.split(o.find).length - 1;
    if (n !== (o.count ?? 1)) throw new Error(`override "${o.id}" matched ${n} times, expected ${o.count ?? 1}`);
    text = text.split(o.find).join(o.replace);
  }
  return text;
}
html = applyOverrides(html, overrides);

// ── encodeCase (mirrors the runtime) ─────────────────────────────────────────
const RAW_WRAP = { select: 'sc-raw-select', table: 'sc-raw-table', tbody: 'sc-raw-tbody', thead: 'sc-raw-thead', tfoot: 'sc-raw-tfoot', tr: 'sc-raw-tr', td: 'sc-raw-td', th: 'sc-raw-th', caption: 'sc-raw-caption' };
const RAW_UNWRAP = Object.fromEntries(Object.entries(RAW_WRAP).map(([k, v]) => [v, k]));
html = html.replace(/(\s)([a-z]+[A-Z][A-Za-z0-9]*)(\s*=)/g, (_, sp, name, eq) => sp + 'sc-camel-' + name.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase()) + eq);
for (const [real, alias] of Object.entries(RAW_WRAP)) html = html.replace(new RegExp('(</?)' + real + '(?=[\\s>])', 'gi'), '$1' + alias);

const EVENT_MAP = { onclick: 'onClick', onchange: 'onChange', oninput: 'onInput', onsubmit: 'onSubmit', onkeydown: 'onKeyDown', onkeyup: 'onKeyUp', onfocus: 'onFocus', onblur: 'onBlur', onmouseenter: 'onMouseEnter', onmouseleave: 'onMouseLeave', onscroll: 'onScroll' };
const kebabToCamel = (s) => s.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
function cssToObj(css) {
  const o = {};
  for (const decl of css.split(';')) {
    const i = decl.indexOf(':');
    if (i < 0) continue;
    const prop = decl.slice(0, i).trim();
    o[prop.startsWith('--') ? prop : kebabToCamel(prop)] = decl.slice(i + 1).trim();
  }
  return o;
}

// ── expressions ──────────────────────────────────────────────────────────────
const IDENT_RE = /^[A-Za-z_$][A-Za-z0-9_$]*/;
function parensWrapWhole(e) {
  let d = 0;
  for (let i = 0; i < e.length - 1; i++) {
    if (e[i] === '(') d++;
    else if (e[i] === ')') { d--; if (d === 0) return false; }
  }
  return true;
}
function topLevelEquality(e) {
  let d = 0;
  for (let i = 0; i < e.length; i++) {
    const c = e[i];
    if (c === '[' || c === '(') d++;
    else if (c === ']' || c === ')') d--;
    else if (d === 0 && (c === '=' || c === '!') && e[i + 1] === '=') {
      if (i > 0 && (e[i - 1] === '=' || e[i - 1] === '!')) continue;
      if (!e.slice(0, i).trim()) continue;
      return { index: i, op: e[i + 2] === '=' ? c + '==' : c + '=' };
    }
  }
  return null;
}
function expr(src, scope) {
  const e = String(src).trim();
  if (!e) return 'undefined';
  if (e[0] === '(' && e[e.length - 1] === ')' && parensWrapWhole(e)) return expr(e.slice(1, -1), scope);
  const eq = topLevelEquality(e);
  if (eq) return `(${expr(e.slice(0, eq.index), scope)} ${eq.op} ${expr(e.slice(eq.index + eq.op.length), scope)})`;
  if (e[0] === '!') return `!(${expr(e.slice(1), scope)})`;
  if (['true', 'false', 'null', 'undefined'].includes(e)) return e;
  if (/^-?\d+(\.\d+)?$/.test(e)) return e;
  if (e.length >= 2 && (e[0] === '"' || e[0] === "'") && e[e.length - 1] === e[0]) return JSON.stringify(e.slice(1, -1));
  const head = e.match(IDENT_RE);
  if (!head) throw new Error(`unsupported expression: ${e}`);
  let out = `${scope}[${JSON.stringify(head[0])}]`;
  let i = head[0].length;
  while (i < e.length) {
    if (e[i] === '.') {
      const m = e.slice(i + 1).match(IDENT_RE) || e.slice(i + 1).match(/^\d+/);
      if (!m) throw new Error(`bad path: ${e}`);
      out += `?.[${JSON.stringify(m[0])}]`;
      i += 1 + m[0].length;
    } else if (e[i] === '[') {
      let d = 1, j = i + 1;
      while (j < e.length && d > 0) { if (e[j] === '[') d++; else if (e[j] === ']') { d--; if (d === 0) break; } j++; }
      out += `?.[${expr(e.slice(i + 1, j), scope)}]`;
      i = j + 1;
    } else throw new Error(`bad path: ${e}`);
  }
  return out;
}
function attrValue(raw, scope) {
  const whole = raw.match(/^\s*\{\{([\s\S]+?)\}\}\s*$/);
  if (whole) return { code: expr(whole[1], scope), dynamic: true };
  if (raw.includes('{{')) {
    const parts = raw.split(/\{\{([\s\S]+?)\}\}/g);
    const code = '`' + parts.map((p, i) => (i & 1 ? '${S(' + expr(p, scope) + ')}' : p.replace(/[`\\$]/g, (c) => '\\' + c))).join('') + '`';
    return { code, dynamic: true };
  }
  return { code: JSON.stringify(raw), dynamic: false, raw };
}

// ── pseudo-class sheet ───────────────────────────────────────────────────────
const pseudo = new Map();
// A pseudo-class value with {{ }} is never interpolated by the runtime, so the
// browser drops that declaration as invalid. Drop it here too (same result).
function importantify(css) {
  return css.split(';').filter((d) => !d.includes('{{')).map((d) => d.trim()).filter(Boolean).map((d) => (/!\s*important$/i.test(d) ? d : d + ' !important')).join(';');
}
function pseudoClass(kind, css) {
  const k = kind + '|' + css;
  if (!pseudo.has(k)) {
    const cls = 'scp' + pseudo.size.toString(36);
    const isEl = kind === 'before' || kind === 'after';
    pseudo.set(k, { cls, rule: `.${cls}${isEl ? '::' : ':'}${kind}{${isEl ? css : importantify(css)}}` });
  }
  return pseudo.get(k).cls;
}

// ── walker ───────────────────────────────────────────────────────────────────
let scopeN = 0;
const NEVER_KEYED = new Set('script style textarea option title select canvas iframe video audio'.split(' '));
const attrsOf = (n) => Object.fromEntries(n.attrs.map((a) => [a.name, a.value]));

function children(node, scope) {
  return (node.childNodes || []).map((c) => walk(c, scope)).filter((x) => x != null);
}
function walk(node, scope) {
  if (node.nodeName === '#text') return text(node.value, scope);
  if (!node.tagName) return null;
  const tag = node.tagName;
  if (tag === 'sc-if') {
    const a = attrsOf(node);
    const kids = children(node, scope);
    return `{${attrValue(a.value || '', scope).code} ? <>${kids.join('')}</> : null}`;
  }
  if (tag === 'sc-for') {
    const a = attrsOf(node);
    const as = a.as || 'item';
    const sub = 'v' + ++scopeN;
    const kids = children(node, sub);
    return `{L(${attrValue(a.list || '', scope).code}).map((item: any, i: number) => { const ${sub} = { ...${scope}, ${JSON.stringify(as)}: item, $index: i }; return <React.Fragment key={i}>${kids.join('')}</React.Fragment>; })}`;
  }
  if (tag === 'image-slot') {
    const a = attrsOf(node);
    return `<ImageSlot src=${JSON.stringify(a.src || '')} shape=${JSON.stringify(a.shape || 'rounded')} radius=${JSON.stringify(a.radius || '12')} fit=${JSON.stringify(a.fit || 'cover')} />`;
  }
  return element(node, scope);
}
function text(value, scope) {
  if (!value.includes('{{')) {
    if (!value.trim() && !value.includes(' ')) return null;
    return `{${JSON.stringify(value)}}`;
  }
  const parts = value.split(/\{\{([\s\S]+?)\}\}/g);
  return parts.map((p, i) => (i & 1 ? `{T(${expr(p, scope)})}` : p ? `{${JSON.stringify(p)}}` : '')).join('');
}
const prop = (key, code) => (/^[A-Za-z_$][\w$]*$/.test(key) ? `${key}={${code}}` : `{...{${JSON.stringify(key)}: ${code}}}`);
function element(node, scope) {
  const realTag = RAW_UNWRAP[node.tagName] || node.tagName;
  const props = [];
  const classes = [];
  let className = null;
  for (const { name, value } of node.attrs) {
    let key = name.startsWith('sc-camel-') ? kebabToCamel(name.slice(9)) : name;
    if (key === 'hint-size' || key.startsWith('hint-')) continue;
    if (key.startsWith('style-')) { classes.push(pseudoClass(key.slice(6), value)); continue; }
    if (key === 'class') key = 'className';
    else if (key === 'for') key = 'htmlFor';
    else if (key.startsWith('on')) key = EVENT_MAP[key] || 'on' + key[2].toUpperCase() + key.slice(3);
    const v = attrValue(value, scope);
    if (key === 'style') {
      props.push(prop('style', v.dynamic ? `css(${v.code})` : JSON.stringify(cssToObj(v.raw))));
    } else if (key === 'className') {
      className = v.code;
    } else if (key === 'value' || key === 'checked') {
      props.push(prop(key, `D(${v.code}, ${key === 'checked' ? 'false' : "''"})`));
    } else {
      props.push(prop(key, v.code));
    }
  }
  if (classes.length) props.push(prop('className', [className, ...classes.map((c) => JSON.stringify(c))].filter(Boolean).join(" + ' ' + ")));
  else if (className) props.push(prop('className', className));
  const kids = node.tagName === 'template' ? [] : children(node, scope);
  void NEVER_KEYED;
  return `<${realTag} ${props.join(' ')}>${kids.join('')}</${realTag}>`;
}

const frag = parseFragment(html);
const top = children(frag, 'v0');
const body = top;

const out = `/* GENERATED by scripts/compile-template.mjs from design/template.html — do not edit. */
/* eslint-disable */
// @ts-nocheck
import React from 'react';
import { T, S, L, D, css, ImageSlot } from '../runtime/helpers';

export function renderTemplate(v0: Record<string, any>): React.ReactNode[] {
  return [
${body.map((b, i) => `    <React.Fragment key={${i}}>${b}</React.Fragment>`).join(',\n')}
  ];
}
`;
mkdirSync(join(root, 'src/generated'), { recursive: true });
writeFileSync(join(root, 'src/generated/template.tsx'), out);
writeFileSync(join(root, 'src/generated/pseudo.css'), '/* GENERATED — pseudo-class rules from style-hover / style-focus-within / style-active attributes. */\n' + [...pseudo.values()].map((p) => p.rule).join('\n') + '\n');
// The logic class ships verbatim; it was written against two globals (DCLogic, React).
const logic = applyOverrides(readFileSync(join(root, 'design/logic.js'), 'utf8'), logicOverrides);
writeFileSync(join(root, 'src/generated/logic.js'), `/* GENERATED from design/logic.js — do not edit. Production behaviour is layered on in src/app/. */
/* eslint-disable */
import React from 'react';
import { DCLogic } from '../runtime/DCLogic';
${logic}
export default Component;
`);
console.log(`compiled template: ${out.length} chars, ${pseudo.size} pseudo-class rules, ${overrides.length + logicOverrides.length} overrides`);
