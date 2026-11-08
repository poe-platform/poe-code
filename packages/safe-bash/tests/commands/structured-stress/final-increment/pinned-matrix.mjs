import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { registerHooks, stripTypeScriptTypes } from 'node:module';

const sources = new Map();
for (const [name, expected] of [
  ['README.md', '4d35075e85c2e20bcd419e8c93cf3f7c248dbcffcee1d06cea54fa4d9476ba5d'],
  ['fixtures.ts', '955fc83173aea8297653a1015e40c41cf0bc471a9268fa159293167f6b0c9059'],
  ['matrix.test.ts', 'e959e6c77016674f438a2daa4fc76cac2a73b1daa8a91ae43052563bc53d99df'],
]) {
  const result = spawnSync('git', ['show', `6a259ff:tests/integration/adapter-tools/${name}`], {
    shell: false, timeout: 2000, maxBuffer: 262144,
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr.toString());
  assert.equal(createHash('sha256').update(result.stdout).digest('hex'), expected);
  if (name.endsWith('.ts')) sources.set(new URL(`../../../integration/adapter-tools/${name}`, import.meta.url).href,
    stripTypeScriptTypes(result.stdout.toString('utf8')));
}
registerHooks({
  load(url, context, nextLoad) {
    const source = sources.get(url);
    return source === undefined ? nextLoad(url, context) : { format: 'module', source, shortCircuit: true };
  },
});
