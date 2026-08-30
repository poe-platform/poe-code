import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { root, ready, identity, save, digest, git } from './tools.mjs';

const marker = ready();
const commit = process.argv[2];
assert(commit, 'supply inspected author implementation freeze commit');
const base = 'tests/stress/harness-timing-20260827/';
const acceptance = JSON.parse(readFileSync(new URL('acceptance-freeze.json', import.meta.url)));
const before = identity();
save('evidence/consumed-before.json', { ...before, authorCommit: commit, marker });
const checks = [];
function check(name, action) {
  try { action(); checks.push({ name, pass: true }); }
  catch (error) { checks.push({ name, pass: false, error: String(error) }); }
}
const source = path => readFileSync(root + path, 'utf8');
const original = path => source(`${base}frozen/fullgate-source/${path}.txt`);
const jq = 'tests/commands/structured-stress/jq-grammar-author-20260827/';
const search = 'tests/commands/search-stress/';
check('all 20 original snapshots retain frozen byte hashes', () => {
  for (const entry of acceptance.verified) assert.equal(digest(readFileSync(root + entry.snapshot)), entry.sha256, entry.snapshot);
});
check('original manifest unchanged', () => assert.equal(digest(readFileSync(root + base + 'frozen/manifest.json')), acceptance.manifestSha256));
check('all fixture inputs and expected triples unchanged', () => assert.equal(digest(readFileSync(root + jq + 'native-boundary-frozen.json')), acceptance.fixtureSha256));
for (const path of [jq + 'harness.ts', search + 'harness.ts']) check(`unowned helper unchanged: ${path}`, () => assert.equal(source(path), original(path)));
check('15-case jq loop only changes adapter and test watchdog', () => {
  const expected = original(jq + 'scan-boundaries.test.ts')
    .replace('from "./harness.js"', 'from "../../../stress/harness-timing-20260827/scan-execution.js"')
    .replace('{ timeout: 15000 }', '{ timeout: 120000 }');
  assert.equal(source(jq + 'scan-boundaries.test.ts'), expected);
});
check('search product command context unchanged', () => {
  const extract = text => text.slice(text.indexOf('async function search('), text.indexOf('\n}', text.indexOf('async function search(')) + 2);
  assert.equal(extract(source(search + 'streaming-cases.ts')), extract(original(search + 'streaming-cases.ts')));
});
check('whole-write, backpressure and exact cancellation cases byte-identical', () => {
  const boundary = 'test("whole-write delivery retains the distinct warning-only native result"';
  const current = source(search + 'streaming-cases.ts');
  const prior = original(search + 'streaming-cases.ts');
  assert(current.includes(boundary));
  assert.equal(current.slice(current.indexOf(boundary)), prior.slice(prior.indexOf(boundary)));
});
check('wrapper retains exact pass6 and zero-status assertions', () => {
  const wrapper = source(search + 'streaming.test.ts');
  assert(wrapper.includes('assert.equal(result.code, 0, text(result.stdout) + text(result.stderr));'));
  assert(wrapper.includes('assert.match(text(result.stdout), /# pass 6\\b/u);'));
  assert(wrapper.includes('"--experimental-test-isolation=none"'));
});
check('scan adapter retains frozen product and shell limits', () => {
  const adapter = source(base + 'scan-execution.ts');
  assert(adapter.includes('const options = { limits: { maxInputBytes: 65536, maxOutputBytes: 65536, maxValueBytes: 32768, maxResults: 4096, maxSteps: 100000 } };'));
  assert(adapter.includes('new Shell({ fs, cwd: "/", env: {}, limits: { maxOutputBytes: 65536 } })'));
  assert(adapter.includes('stdinIsDefault: false'));
});
const authored = git('diff-tree', '--no-commit-id', '--name-only', '-r', commit).split('\n').filter(Boolean);
check('implementation freeze contains only allowed harness paths', () => {
  for (const path of authored) assert(path.startsWith(base) && !path.includes('/review/') || [jq + 'scan-boundaries.test.ts', search + 'streaming-cases.ts', search + 'streaming.test.ts'].includes(path), path);
});
check('consumed implementation files match author commit bytes', () => {
  for (const path of authored) assert.equal(digest(readFileSync(root + path)), digest(execFileSync('git', ['show', `${commit}:${path}`], { cwd: root, maxBuffer: 16 * 1024 * 1024 })), path);
});
const changesSinceIndependentFreeze = Object.entries(acceptance.source).filter(([path, hash]) => before.hashes[path] !== hash).map(([path, sha256]) => ({ path, frozen: sha256, current: before.hashes[path] }));
save('evidence/static-audit.json', { commit, checks, changesSinceIndependentFreeze, checksPassed: checks.filter(check => check.pass).length, checksTotal: checks.length });
console.log(JSON.stringify({ checks, changesSinceIndependentFreeze }, null, 2));
assert(checks.every(check => check.pass), 'static audit findings require review; evidence retained');
