'use strict';
const assert = require('assert');
const { test, call } = require('./tools-check');

test('blueprint_plan posts the source to /api/blueprints/plan', async () => {
  const { calls } = await call('joytree_blueprint_plan', { repoUrl: 'https://github.com/a/b', branch: 'dev', blueprintPath: 'infra/joytree.joy' });
  assert.strictEqual(calls[0].path, '/api/blueprints/plan');
  assert.deepStrictEqual(calls[0].body.blueprintPath, 'infra/joytree.joy');
  assert.strictEqual(calls[0].body.branch, 'dev');
});

test('blueprint_deploy sends env and name overrides; requires a source', async () => {
  const { calls } = await call('joytree_blueprint_deploy', {
    repoUrl: 'https://github.com/a/b', envOverrides: { api: { KEY: 'v' } }, serviceNameOverrides: { api: 'api2' },
  });
  assert.strictEqual(calls[0].path, '/api/blueprints/deploy');
  assert.deepStrictEqual(calls[0].body.envOverrides, { api: { KEY: 'v' } });
  assert.deepStrictEqual(calls[0].body.serviceNameOverrides, { api: 'api2' });
  const bad = await call('joytree_blueprint_deploy', {});
  assert.strictEqual(bad.res.isError, true);
  assert.strictEqual(bad.calls.length, 0, 'must not hit the API without a source');
});

test('blueprint_browse posts to /api/blueprints/browse', async () => {
  const { calls } = await call('joytree_blueprint_browse', { repoUrl: 'https://github.com/a/b', dir: 'infra' });
  assert.strictEqual(calls[0].path, '/api/blueprints/browse');
  assert.strictEqual(calls[0].body.dir, 'infra');
});
