import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, appendFileSync, realpathSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { fileURLToPath } from 'node:url';

const configuration = JSON.parse(readFileSync(new URL('./guard-config.json', import.meta.url)));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const record = value => appendFileSync(configuration.log, JSON.stringify({ pid: process.pid, ...value }) + '\n');
function inspect(url, phase, parentURL) {
  if (!url.startsWith('file:')) {
    assert.ok(url.startsWith('node:') || url.startsWith('data:'), 'unsupported import protocol');
    return;
  }
  const path = fileURLToPath(url);
  const real = realpathSync(path);
  assert.equal(real, path, 'symlink runtime import rejected');
  assert.ok(real.startsWith(configuration.archive + '/'), 'outside-archive import rejected');
  const relative = real.slice(configuration.archive.length + 1);
  const sha256 = hash(readFileSync(real));
  assert.equal(sha256, configuration.hashes[relative], 'unfrozen/changed runtime import: ' + relative);
  record({ phase, path: relative, sha256, parentURL });
}
registerHooks({
  resolve(specifier, context, next) {
    const result = next(specifier, context);
    inspect(result.url, 'resolve', context.parentURL);
    return result;
  },
  load(url, context, next) {
    inspect(url, 'load');
    return next(url, context);
  },
});
let rejected = false;
try { await import(configuration.forbidden); }
catch (error) { rejected = error.message.includes('outside-archive import rejected'); }
assert.equal(rejected, true, 'outside-archive negative import must be rejected');
record({ phase: 'negative-control', rejected, node: process.version });
