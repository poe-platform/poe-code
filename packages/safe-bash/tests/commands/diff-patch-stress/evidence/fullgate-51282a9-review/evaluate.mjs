import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { base, save } from './replay.mjs';

const label = process.argv[2];
const outputLabel = process.argv[3] ?? label;
assert(label);
const baseline = JSON.parse(readFileSync(`${base}/initial-extra-control-native-product.json`, 'utf8'));
const replay = JSON.parse(readFileSync(`${base}/${label}-native-product.json`, 'utf8'));
assert.deepEqual(replay.profiles, baseline.profiles);
assert.equal(replay.results.length, baseline.results.length);
function stableNamespace(entries) {
  return Object.fromEntries(Object.entries(entries).map(([path, { inode, device, ...entry }]) => [path, entry]));
}
const checks = [];
function check(name, operation) {
  try { operation(); checks.push({ name, passed: true }); }
  catch (error) { checks.push({ name, passed: false, message: error.message }); }
}
for (const [index, result] of replay.results.entries()) {
  const original = baseline.results[index];
  check(`${result.fixture.name}: frozen input binding`, () => {
    assert.deepEqual(result.fixture, original.fixture);
    assert.equal(result.inputSha256, original.inputSha256);
  });
  check(`${result.fixture.name}: both native profiles remain exact`, () => {
    for (const [profileIndex, native] of result.natives.entries()) {
      const before = original.natives[profileIndex];
      const rootPattern = new RegExp(`${resolve(base).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/\\.?scratch/native-[A-Za-z0-9]+`);
      const nativeRoot = native.args.find(value => value.endsWith('/authorized/target'))?.slice(0, -'/authorized/target'.length) ?? native.stdout.match(rootPattern)?.[0];
      const beforeRoot = before.args.find(value => value.endsWith('/authorized/target'))?.slice(0, -'/authorized/target'.length) ?? before.stdout.match(rootPattern)?.[0];
      const normalize = (text, root, namespace) => {
        let result = root ? text.replaceAll(root, '<native-root>') : text;
        for (const path of Object.keys(namespace).filter(path => /^\/patch[A-Za-z0-9]+$/.test(path))) result = result.replaceAll(`<native-root>${path}`, '<native-root>/<apple-patch-temp>');
        return result;
      };
      assert.equal(native.status, before.status);
      assert.equal(normalize(native.stdout, nativeRoot, native.after), normalize(before.stdout, beforeRoot, before.after));
      assert.equal(normalize(native.stderr, nativeRoot, native.after), normalize(before.stderr, beforeRoot, before.after));
      assert.deepEqual(stableNamespace(native.before), stableNamespace(before.before));
      const nativeAfter = stableNamespace(native.after);
      const beforeAfter = stableNamespace(before.after);
      const remapTemporary = namespace => Object.fromEntries(Object.entries(namespace).map(([path, value]) => [path.startsWith('/patch') ? '/<apple-patch-temp>' : path, value]));
      assert.deepEqual(remapTemporary(nativeAfter), remapTemporary(beforeAfter));
    }
  });
  check(`${result.fixture.name}: complete virtual outcome`, () => {
    if (result.fixture.name === 'repeated hunk later matching line control') {
      assert.equal(result.virtual.status, 1);
      assert.equal(result.virtual.stdout, '');
      assert.equal(result.virtual.stderr, 'patch: hunk 2 does not match target\n');
      assert.deepEqual(result.virtual.after, result.virtual.before);
    } else assert.deepEqual(result.virtual, original.virtual);
  });
}
save(`${base}/${outputLabel}-evaluation.json`, { checks, assertionCount: checks.length, passed: checks.filter(row => row.passed).length, failed: checks.filter(row => !row.passed).length, coverage: 'Eight original cases, four bounded controls; assertions are not additional cases', nativeNormalization: 'Only recorded reviewer native root and exact Apple temporary entry name are tokenized. Raw stdout/stderr and full namespaces retained. Status, diagnostics, path structure, contents, modes and link counts remain exact; per-run inode/device retained raw but not cross-run equality targets.' });
console.log(checks.filter(row => !row.passed));
process.exitCode = checks.every(row => row.passed) ? 0 : 1;
