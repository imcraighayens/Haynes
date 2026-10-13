// Unpacks the delivered Quik1 design bundle (docs/quik1/design-source/quik1-prototype.html)
// into source the app builds from:
//   design/template.html   the x-dc template (helmet stripped, asset uuids → /assets paths)
//   design/logic.js        the logic class, verbatim
//   design/props.json      the declared props + defaults
//   design/global.css      the helmet <style> blocks (fonts + keyframes + base rules)
//   public/assets/...      fonts and images
//
// Run once whenever the design is re-exported: `npm run extract`.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const bundlePath = join(root, '../../docs/quik1/design-source/quik1-prototype.html');
const src = readFileSync(bundlePath, 'utf8');

const island = (type) => {
  const m = src.match(new RegExp(`<script type="__bundler/${type}">\\s*([\\s\\S]*?)\\s*</script>`));
  if (!m) throw new Error(`bundle island ${type} missing`);
  return JSON.parse(m[1]);
};
const manifest = island('manifest');
let template = island('template');

// Stable, readable names for the image assets.
const IMAGES = {
  '9385ac18-1427-408b-b351-d86435f8c60f': 'img/quik1-wordmark.png',
  'ac0f47ff-543c-4cf9-878b-c92c60c53c7a': 'img/quik1-mark.png',
  'c7cea2e4-389e-4a64-941a-4eaf5247f317': 'img/promo.webp',
  'c1d1957e-ecd6-4f39-8d7f-961aa5f07abd': 'img/illustration.png',
};

const bytes = (uuid) => {
  const e = manifest[uuid];
  const b = Buffer.from(e.data, 'base64');
  return e.compressed ? gunzipSync(b) : b;
};
const out = (rel, data) => {
  const p = join(root, rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, data);
};

const paths = {};
for (const [uuid, rel] of Object.entries(IMAGES)) {
  out('public/assets/' + rel, bytes(uuid));
  paths[uuid] = '/assets/' + rel;
}

// Fonts: name each file after the @font-face block that references it.
const faceRe = /\/\*\s*([\w-]+)\s*\*\/\s*@font-face\s*\{([^}]*)\}/g;
for (const m of template.matchAll(faceRe)) {
  const subset = m[1];
  const weight = m[2].match(/font-weight:\s*(\d+)/)[1];
  const style = m[2].match(/font-style:\s*(\w+)/)[1];
  const uuid = m[2].match(/url\("([0-9a-f-]{36})"\)/)[1];
  const rel = `fonts/ubuntu-${weight}${style === 'italic' ? 'i' : ''}-${subset}.woff2`;
  out('public/assets/' + rel, bytes(uuid));
  paths[uuid] = '/assets/' + rel;
}

for (const [uuid, p] of Object.entries(paths)) template = template.split(uuid).join(p);

// Split template: helmet styles → global.css, logic script → logic.js, x-dc body → template.html
const helmet = template.slice(template.indexOf('<helmet>') + 8, template.indexOf('</helmet>'));
const css = [...helmet.matchAll(/<style>([\s\S]*?)<\/style>/g)].map((m) => m[1].trim()).filter(Boolean).join('\n\n');
out('design/global.css', '/* Extracted from the delivered design bundle — do not edit by hand; run `npm run extract`. */\n' + css + '\n');

const scriptM = template.match(/<script type="text\/x-dc" data-dc-script="" data-props="([^"]*)">([\s\S]*?)<\/script>/);
const decode = (s) => s.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const props = JSON.parse(decode(scriptM[1]));
out('design/props.json', JSON.stringify(props, null, 2) + '\n');
out('design/logic.js', scriptM[2].replace(/^\n/, ''));

const body = template.slice(template.indexOf('</helmet>') + 9, template.indexOf('</x-dc>'));
out('design/template.html', body.trim() + '\n');

console.log('extracted', Object.keys(paths).length, 'assets;', body.length, 'chars of template');
