import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';

const entry = fileURLToPath(new URL('../../../../safe-bash-command-csvkit/src/default-csvpy.ts', import.meta.url));
test('browser consumers select a worker backend without Node imports', async () => {
  const result = await build({entryPoints: [entry], bundle: true, platform: 'browser', format: 'esm', define: {process: 'undefined'}, conditions: ['browser'], write: false, metafile: true});
  const inputs = Object.keys(result.metafile.inputs);
  assert.ok(inputs.some(path => path.endsWith('/python-worker-browser.ts') || path.endsWith('/python-worker-browser.js')));
  assert.ok(!inputs.some(path => path.endsWith('/python-worker-node.js')));
  assert.ok(Object.values(result.metafile.outputs).every(output => output.imports.length === 0));
});

test('portable publication preserves conditional worker selection for Node consumers', async () => {
  const result = await build({entryPoints: [entry], bundle: true, platform: 'browser', format: 'esm', define: {process: 'undefined'}, external: ['#csvpy-worker'], write: false, metafile: true});
  assert.ok(Object.values(result.metafile.outputs).some(output => output.imports.some(item => item.path === '#csvpy-worker' && item.external)));
});
