'use strict';

// Offline check of tool -> HTTP request mapping. Registers every tool against
// a stub server and a recording client, so no network or API key is needed.
const assert = require('assert');
const { registerJoyTreeTools } = require('../src/tools');

const handlers = {};
const schemas = {};
const stubServer = {
  registerTool(name, config, fn) { handlers[name] = fn; schemas[name] = config; },
};

const calls = [];
const recordingClient = {};
for (const m of ['get', 'post', 'put', 'patch', 'del']) {
  const verb = m === 'del' ? 'DELETE' : m.toUpperCase();
  recordingClient[m] = async (path, body) => { calls.push({ method: verb, path, body }); return { ok: true }; };
}
// Tests can swap in a custom client (e.g. one that returns canned GET data).
let activeClient = recordingClient;
const useClient = (c) => { activeClient = c || recordingClient; };
registerJoyTreeTools(stubServer, () => activeClient);

async function call(name, args) {
  calls.length = 0;
  const res = await handlers[name](args, {});
  return { res, calls: calls.slice() };
}

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

test('deploy_from_github forwards worker/dockerfile options and omits unset ones', async () => {
  const { calls: c } = await call('joytree_deploy_from_github', {
    name: 'w', repoUrl: 'https://github.com/a/b', isWorker: true, startCmd: 'node worker.js',
    dockerfilePath: 'worker/Dockerfile', exposedPort: 8080, runtime: 'node',
  });
  assert.strictEqual(c[0].path, '/api/v1/deploy');
  assert.strictEqual(c[0].body.isWorker, true);
  assert.strictEqual(c[0].body.dockerfilePath, 'worker/Dockerfile');
  assert.strictEqual(c[0].body.exposedPort, 8080);
  assert.strictEqual(c[0].body.runtime, 'node');
  assert.ok(!('pythonVer' in c[0].body), 'unset option must not be sent');
});

test('deploy_from_zip and zip finish forward the same options', async () => {
  const z = await call('joytree_deploy_from_zip', { name: 'z', zipUrl: 'https://x/y.zip', isDockerfileDeploy: true, envVars: { A: '1' } });
  assert.strictEqual(z.calls[0].body.isDockerfileDeploy, true);
  assert.deepStrictEqual(z.calls[0].body.envVars, { A: '1' });
  const f = await call('joytree_zip_upload_finish', { uploadId: 'u1', name: 'z', isWorker: true, startCmd: 'x' });
  assert.strictEqual(f.calls[0].path, '/api/v1/zip-uploads/u1/finish');
  assert.strictEqual(f.calls[0].body.isWorker, true);
});

module.exports = { test, tests, call, handlers, schemas, calls, useClient };

if (require.main === module) {
  (async () => {
    // Later test files register additional cases onto the same list.
    for (const f of require('fs').readdirSync(__dirname).filter(n => /^tools-check\..+\.js$/.test(n))) {
      require('./' + f);
    }
    let failed = 0;
    for (const [name, fn] of tests) {
      try { await fn(); console.log('PASS', name); }
      catch (e) { failed++; console.log('FAIL', name, '\n   ', e.message); }
    }
    console.log(`\n${tests.length - failed}/${tests.length} passed`);
    process.exit(failed ? 1 : 0);
  })();
}
