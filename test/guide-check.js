'use strict';

// Verifies the /guide setup page: it renders, every screenshot it references
// is served, and every screenshot has at least one numbered marker + legend.
const BASE = process.env.BASE || 'http://localhost:8787';

async function main() {
  const res = await fetch(`${BASE}/guide`);
  const html = await res.text();
  const fail = (m) => { console.error('FAIL:', m); process.exit(1); };

  if (res.status !== 200) fail(`GET /guide -> ${res.status}`);
  if (!/text\/html/.test(res.headers.get('content-type') || '')) fail('not served as text/html');
  if (!html.includes('Connect JoyTree to Claude')) fail('missing hero heading');
  if (!html.includes('https://mcp.joytree.site/mcp')) fail('missing connector URL');

  const imgs = [...html.matchAll(/<img src="(\/guide\/assets\/[^"]+)"[^>]*alt="([^"]*)"/g)];
  if (imgs.length < 8) fail(`expected 8 screenshots, found ${imgs.length}`);
  for (const [, src, alt] of imgs) {
    if (!alt.trim()) fail(`empty alt text on ${src}`);
    const r = await fetch(BASE + src);
    if (r.status !== 200 || !/image\/webp/.test(r.headers.get('content-type') || '')) fail(`${src} -> ${r.status}`);
  }

  // every figure: markers must match the legend length
  const figures = html.split('<figure>').slice(1).map((f) => f.split('</figure>')[0]);
  for (const f of figures) {
    const pins = (f.match(/class="pin"/g) || []).length;
    const items = (f.match(/<li>/g) || []).length;
    if (pins === 0 || pins !== items) fail(`figure has ${pins} markers but ${items} legend items`);
  }

  const miss = await fetch(`${BASE}/guide/assets/does-not-exist.webp`);
  if (miss.status !== 404) fail('unknown asset should 404');

  console.log(`guide OK: ${imgs.length} screenshots, ${figures.length} figures, markers match legends`);
}
main().catch((e) => { console.error(e); process.exit(1); });
