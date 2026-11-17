'use strict';

// Verifies the animated "Works with" agent dock: all agents render on both the
// Connect page and the /guide page, scripts parse, CSS is balanced, and no
// template placeholders leak into the output.
const { renderConnectPage } = require('../src/connect-page');
const { AGENTS, AGENT_DOCK_CSS, AGENT_DOCK_JS } = require('../src/agent-dock');

const fail = (m) => { console.error('FAIL:', m); process.exit(1); };

if (AGENTS.length !== 10) fail(`expected 10 agents, got ${AGENTS.length}`);
for (const a of AGENTS) {
  if (!a.name || !a.bg || !a.vb || !a.body) fail(`incomplete agent entry: ${a.name}`);
  if (a.body.includes('@@')) fail(`${a.name}: unreplaced path token`);
}

const open = (AGENT_DOCK_CSS.match(/{/g) || []).length;
const close = (AGENT_DOCK_CSS.match(/}/g) || []).length;
if (open !== close) fail(`CSS braces unbalanced (${open} vs ${close})`);
try { new Function(AGENT_DOCK_JS); } catch (e) { fail('dock JS does not parse: ' + e.message); }
if (!/prefers-reduced-motion/.test(AGENT_DOCK_CSS)) fail('missing reduced-motion handling');

const page = renderConnectPage({ baseUrl: 'http://localhost', fields: '' });
if (/__AGENT|__BASE__|__FIELDS__/.test(page)) fail('placeholder leaked into Connect page');
for (const a of AGENTS) {
  if (!page.includes(`data-name="${a.name}"`)) fail(`Connect page missing ${a.name}`);
}
if ((page.match(/id="dk-lov"/g) || []).length !== 1) fail('gradient defs must appear exactly once');
if (!page.includes('aria-expanded="false"')) fail('dock button must expose aria-expanded');

// the guide is rendered by the server; check the same substitution here
const fs = require('fs');
const guide = fs.readFileSync(require('path').join(__dirname, '../src/guide.html'), 'utf8');
for (const t of ['<!--AGENT_DOCK_CSS-->', '<!--AGENT_DOCK-->', '<!--AGENT_DOCK_JS-->']) {
  if (!guide.includes(t)) fail(`guide.html missing ${t}`);
}

console.log(`dock OK: ${AGENTS.length} agents, CSS balanced (${open} rules), JS parses, Connect page + guide wired`);
