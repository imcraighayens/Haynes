// Render helpers used by the generated template. Each mirrors the behaviour of
// the design runtime the prototype was authored in, so output DOM is identical.
import React from 'react';

const kebabToCamel = (s: string) => s.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());

/** Inline style string → React style object (same naive `;` splitter as the runtime). */
export function css(value: unknown): React.CSSProperties | undefined {
  if (typeof value !== 'string') return value as React.CSSProperties | undefined;
  const o: Record<string, string> = {};
  for (const decl of value.split(';')) {
    const i = decl.indexOf(':');
    if (i < 0) continue;
    const prop = decl.slice(0, i).trim();
    o[prop.startsWith('--') ? prop : kebabToCamel(prop)] = decl.slice(i + 1).trim();
  }
  return o as React.CSSProperties;
}

/** Interpolated value inside a mixed attribute string. */
export const S = (v: unknown) => v ?? '';

/** Interpolated text: strings/numbers render inside span.sc-interp, elements pass through. */
export function T(v: unknown): React.ReactNode {
  if (v === undefined || v === null || typeof v === 'boolean') return null;
  if (React.isValidElement(v) || Array.isArray(v)) return <>{v}</>;
  return <span className="sc-interp">{String(v)}</span>;
}

/** sc-for list: anything that is not an array renders nothing. */
export const L = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/** value/checked default when unresolved. */
export const D = <T,>(v: T | undefined, d: T) => (v === undefined ? d : v);

/** Read-only equivalent of the prototype's <image-slot> element. */
export function ImageSlot({ src, shape, radius, fit }: { src: string; shape: string; radius: string; fit: string }) {
  const n = parseFloat(radius);
  const r = shape === 'circle' ? '50%' : shape === 'pill' ? '9999px' : shape === 'rounded' ? `${Number.isFinite(n) ? n : 12}px` : '';
  return (
    <div style={{ display: 'block', position: 'relative', font: '13px/1.3 system-ui,-apple-system,sans-serif', width: '100%', height: '100%', aspectRatio: '3/2' }}>
      <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', background: 'rgba(127,127,127,.08)', borderRadius: r }}>
        <img src={src} alt="" draggable={false} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: fit === 'contain' ? 'contain' : 'cover', userSelect: 'none' }} />
      </div>
    </div>
  );
}
