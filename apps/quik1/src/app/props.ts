import meta from '../../design/props.json';

/** Default values for the props the design declares (brand, interestRate, lending rules, appearance). */
export function designDefaults(): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, m] of Object.entries(meta as Record<string, { default?: unknown }>)) {
    if (k.startsWith('$')) continue;
    if (m && m.default !== undefined) out[k] = m.default;
  }
  return out;
}
