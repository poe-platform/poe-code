import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const recipe = dirname(fileURLToPath(import.meta.url)), scope = resolve(recipe, '..'), repository = resolve(scope, '../../../..');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const json = target => JSON.parse(fs.readFileSync(target));
const manifestBytes = fs.readFileSync(join(recipe, 'MANIFEST.json'));
assert.equal(hash(manifestBytes), process.argv[3]);
assert.match(process.argv[2] ?? '', /^[a-f0-9]{40}$/u);
const manifest = JSON.parse(manifestBytes);
const node = '/Users/kjopek/.nvm/versions/node/v22.22.2/bin/node';
const git = '/Applications/Xcode.app/Contents/Developer/usr/bin/git';
assert.equal(process.execPath, node);
assert.equal(hash(fs.readFileSync(node)), '5c899797c4eb8f1db5563eea56538342ddb3e9276ee1b04a5a1f0f1023d2b011');
assert.equal(hash(fs.readFileSync(git)), '10f9c1df894525ae4c7454258febab6d3d25071062b42cb48dbb1842cdffd2a9');
let gitReturns = 0;
for (const [name, digest] of Object.entries({ ...manifest.files, 'MANIFEST.json': process.argv[3] })) {
  assert.ok(!name.includes('/') && name !== 'AGENTS.md');
  assert.ok(fs.lstatSync(join(recipe, name)).isFile()); assert.equal(hash(fs.readFileSync(join(recipe, name))), digest);
  const path = `tests/commands/timeout-independent-20260828/review-preparation-v1/recipe/${name}`;
  const bytes = execFileSync(git, ['--no-replace-objects', '--no-optional-locks', '-C', repository, 'show', `${process.argv[2]}:${path}`], { timeout: 15000, maxBuffer: 1024 ** 2, env: { PATH: '/usr/bin:/bin', HOME: scope, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', LC_ALL: 'C' } });
  gitReturns++; assert.equal(hash(bytes), digest);
}
const protectedRows = json(join(recipe, 'PROTECTED.json'));
function authenticateProtected() {
  for (const row of protectedRows) { const target = join(repository, row.path); assert.ok(fs.lstatSync(target).isFile()); assert.equal(hash(fs.readFileSync(target)), row.sha256, row.path); }
}
authenticateProtected();
const { controls } = await import('./controls.mjs');
assert.equal(controls.length, 24);
assert.deepEqual(controls.map(row => row.id), Array.from({ length: 24 }, (_, index) => `D${String(index + 1).padStart(2, '0')}`));
const output = join(scope, 'control-evidence'); fs.mkdirSync(output);
const record = (name, value) => fs.writeFileSync(join(output, name), `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' });
const report = { schema: 'timeout-development-support-controls/1', startedAt: new Date().toISOString(), recipeCommit: process.argv[2], manifestSha256: process.argv[3], controls: [], expected: 24, productExecuted: 0, nativeExecuted: 0, sourceInspected: false, candidateIdentitySuppliedByRootOnly: '9ed9a0f14d12758713a8dc42be1ff75f0c87a36f', gitSynchronousNaturalReturns: gitReturns, productAcceptance: false };
const unhandled = [];
const listener = reason => unhandled.push({ type: typeof reason, text: String(reason) });
process.on('unhandledRejection', listener);
record('PRE.json', { at: report.startedAt, protectedFiles: protectedRows.length, gitSynchronousNaturalReturns: gitReturns, nodeSha256: hash(fs.readFileSync(node)), gitSha256: hash(fs.readFileSync(git)), recipeSha256: hash(manifestBytes) });
try {
  for (const control of controls) {
    const row = { id: control.id, name: control.name, classification: 'development-only-synthetic-control', status: 'PASS' };
    try { await control.run(); } catch (error) { row.status = 'FAIL'; row.error = { name: error?.name, code: error?.code, message: error?.message, stack: error?.stack }; }
    record(`${control.id}.json`, row); report.controls.push(row); assert.equal(row.status, 'PASS', control.id);
  }
  await new Promise(resolveTurn => setImmediate(resolveTurn));
  assert.deepEqual(unhandled, []);
  authenticateProtected();
  for (const [name, digest] of Object.entries(manifest.files)) assert.equal(hash(fs.readFileSync(join(recipe, name))), digest);
  report.status = 'DEVELOPMENT_SUPPORT_VALIDATED_NOT_PRODUCT_REVIEW';
} catch (error) { report.status = 'STOP_NO_RETRY'; report.error = { name: error?.name, message: error?.message, stack: error?.stack }; process.exitCode = 1; }
finally {
  process.removeListener('unhandledRejection', listener);
  report.finishedAt = new Date().toISOString(); report.unhandled = unhandled;
  report.passed = report.controls.filter(row => row.status === 'PASS').length;
  report.unexecuted = controls.filter(row => !report.controls.some(done => done.id === row.id)).map(row => row.id);
  report.controlBodyChildren = 0; report.controlBodyTimerHandles = 0;
  record('RESULT.json', report); console.log(JSON.stringify({ status: report.status, passed: report.passed, expected: 24, unexecuted: report.unexecuted, productExecuted: 0, nativeExecuted: 0 }));
}
