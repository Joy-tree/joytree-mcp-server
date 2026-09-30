'use strict';
const assert = require('assert');
const { test, call, schemas } = require('./tools-check');

const rule = { name: 'Block admin', groups: [[{ field: 'path', op: 'starts_with', value: '/admin' }]], action: { type: 'deny', status: 403 } };

test('firewall_rule maps each action to the right verb and path', async () => {
  let r = await call('joytree_firewall_rule', { projectId: 'my app', action: 'add', rule });
  assert.deepStrictEqual([r.calls[0].method, r.calls[0].path], ['POST', '/api/projects/my%20app/firewall/rules']);
  r = await call('joytree_firewall_rule', { projectId: 'p', action: 'update', ruleId: 'rule_1', rule });
  assert.deepStrictEqual([r.calls[0].method, r.calls[0].path], ['PUT', '/api/projects/p/firewall/rules/rule_1']);
  r = await call('joytree_firewall_rule', { projectId: 'p', action: 'disable', ruleId: 'rule_1' });
  assert.deepStrictEqual([r.calls[0].method, r.calls[0].body], ['PATCH', { enabled: false }]);
  r = await call('joytree_firewall_rule', { projectId: 'p', action: 'delete', ruleId: 'rule_1' });
  assert.strictEqual(r.calls[0].method, 'DELETE');
  r = await call('joytree_firewall_rule', { projectId: 'p', action: 'reorder', orderedIds: ['b', 'a'] });
  assert.deepStrictEqual(r.calls[0].body, { ids: ['b', 'a'] });
});

test('firewall_rule rejects missing arguments without calling the API', async () => {
  for (const args of [{ action: 'add' }, { action: 'update', rule }, { action: 'delete' }, { action: 'reorder' }]) {
    const r = await call('joytree_firewall_rule', { projectId: 'p', ...args });
    assert.strictEqual(r.res.isError, true, JSON.stringify(args));
    assert.strictEqual(r.calls.length, 0);
  }
});

test('firewall_ip_list adds with expiry only on the block list', async () => {
  let r = await call('joytree_firewall_ip_list', { projectId: 'p', list: 'block', action: 'add', ips: ['1.2.3.4'], expires: '24h', note: 'abuse' });
  assert.strictEqual(r.calls[0].path, '/api/projects/p/firewall/ip-blocks');
  assert.strictEqual(r.calls[0].body.expires, '24h');
  r = await call('joytree_firewall_ip_list', { projectId: 'p', list: 'bypass', action: 'add', ips: ['1.2.3.4'], expires: '24h' });
  assert.strictEqual(r.calls[0].path, '/api/projects/p/firewall/bypass');
  assert.ok(!('expires' in r.calls[0].body));
});

test('firewall_ip_list removes by IP by resolving entry ids first', async () => {
  const { handlers, useClient } = require('./tools-check');
  const seen = [];
  const client = {
    get: async (p) => { seen.push(['GET', p]); return { ipBlocks: [{ id: 'e1', ip: '1.2.3.4' }, { id: 'e2', ip: '5.6.7.8' }] }; },
    post: async (p, b) => { seen.push(['POST', p, b]); return { ok: true }; },
  };
  useClient(client);
  try {
    await handlers.joytree_firewall_ip_list({ projectId: 'p', list: 'block', action: 'remove', ips: ['5.6.7.8'] }, {});
    assert.deepStrictEqual(seen[1], ['POST', '/api/projects/p/firewall/ip-blocks/delete', { ids: ['e2'] }]);
    const miss = await handlers.joytree_firewall_ip_list({ projectId: 'p', list: 'block', action: 'remove', ips: ['9.9.9.9'] }, {});
    assert.strictEqual(miss.isError, true);
    assert.strictEqual(seen.filter(x => x[0] === 'POST').length, 1, 'no delete call when nothing matches');
  } finally { useClient(null); }
});

test('firewall settings, attack mode, simulate and activity hit the right endpoints', async () => {
  let r = await call('joytree_firewall_settings', { projectId: 'p', section: 'ddos', settings: { sensitivity: 'high' } });
  assert.deepStrictEqual([r.calls[0].method, r.calls[0].path], ['PUT', '/api/projects/p/firewall/settings/ddos']);
  r = await call('joytree_firewall_attack_mode', { projectId: 'p', enabled: true, durationMin: 60 });
  assert.deepStrictEqual(r.calls[0].body, { enabled: true, durationMin: 60 });
  r = await call('joytree_firewall_simulate', { projectId: 'p', request: { path: '/admin' }, draftRule: rule });
  assert.strictEqual(r.calls[0].path, '/api/projects/p/firewall/simulate');
  assert.deepStrictEqual(r.calls[0].body.rule, rule);
  r = await call('joytree_firewall_activity', { projectId: 'p', view: 'events', limit: 20, action: 'deny' });
  assert.strictEqual(r.calls[0].path, '/api/projects/p/firewall/events?limit=20&action=deny');
  r = await call('joytree_firewall_activity', { projectId: 'p', view: 'analytics', range: '7d' });
  assert.strictEqual(r.calls[0].path, '/api/projects/p/firewall/analytics?range=7d');
});

test('firewall tools are flagged correctly in annotations', () => {
  assert.strictEqual(schemas.joytree_firewall_get.annotations.readOnlyHint, true);
  assert.strictEqual(schemas.joytree_firewall_simulate.annotations.readOnlyHint, true);
  assert.strictEqual(schemas.joytree_firewall_rule.annotations.destructiveHint, true);
});
