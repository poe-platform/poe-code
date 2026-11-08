import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {existsSync, readFileSync, realpathSync, writeFileSync} from 'node:fs';
import {registerHooks} from 'node:module';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';

const config = JSON.parse(readFileSync(process.argv[2]));
const report = {controls: [], loads: []};
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
registerHooks({load(url, context, next) {
  if (url.startsWith('node:')) return next(url, context);
  const path = realpathSync(fileURLToPath(url));
  const name = path.slice(config.owned.length + 1);
  assert.ok(path.startsWith(config.owned + '/') && Object.hasOwn(config.driverHashes, name));
  assert.ok(!['execute.mjs', 'public.mjs', 'worker.mjs', 'run.mjs', 'review-build-types.mjs', 'review-build-types-worker.mjs'].includes(name));
  const sha256 = hash(readFileSync(path)); assert.equal(sha256, config.driverHashes[name]); report.loads.push({path, sha256});
  return next(url, context);
}});
const {extractCommitted, ARCHIVE_PATH_PROFILE} = await import('./transport.mjs');
const {verifyArchive} = await import('./inventory.mjs');
const {createObserverClient} = await import('./process-observer.mjs');
const observer = createObserverClient(process.env.UNIFIED76_OBSERVER_TOKEN);
async function check(id, body) {
  try { report.controls.push({id, status: 'PASS', evidence: await body()}); }
  catch (error) { report.controls.push({id, status: 'FAIL', error: error.stack}); }
}
async function refuse(id, body) {
  let refusal;
  try { await body(); } catch (error) { refusal = {message: error.message, code: error.code}; }
  assert.ok(refusal, id + ' unexpectedly admitted'); return refusal;
}
const input = entries => ({git: config.git, repository: config.repo, candidate: config.candidate, entries, destination: join(config.target, 'case-' + report.controls.length), environment: config.environment, bounds: {...config.bounds, archiveEntries: entries.length, archiveBytes: entries.reduce((sum, entry) => sum + entry.bytes, 0)}, observer});
try {
  await check('inner-ps-and-write-fences', async () => {
    const ps = spawnSync('/bin/ps', ['-axo', 'pid='], {encoding: 'utf8', timeout: 2000, maxBuffer: 65536});
    assert.equal(ps.error?.code, 'EPERM');
    let code; try { writeFileSync(config.forbidden, 'must be refused', {flag: 'wx'}); } catch (error) { code = error.code; }
    assert.equal(code, 'EPERM'); return {ps: {status: ps.status, error: ps.error?.code}, writeError: code};
  });
  await check('foreign-pid-registration-refused', () => refuse('foreign PID', () => observer.register(config.foreignPid)));
  await check('unknown-handle-refused', () => refuse('unknown handle', () => observer.members({handle: 'unknown-independent-handle'})));
  await check('wrong-channel-token-refused', () => refuse('wrong token', () => createObserverClient('independent-wrong-token').register(config.foreignPid)));
  await check('positive-exact-backslash-and-contained-link', async () => {
    const options = input(config.entries); const result = await extractCommitted(options); const archive = await verifyArchive(options.destination, config.entries);
    assert.equal(readFileSync(join(options.destination, 'contained'), 'utf8'), 'independent transport bytes\n');
    assert.equal(readFileSync(join(options.destination, 'literal-link'), 'utf8'), 'POSIX backslash is data\n');
    assert.equal(existsSync(join(options.destination, 'literal/name')), false);
    return {result, archive, pathProfile: ARCHIVE_PATH_PROFILE};
  });
  for (const [id, entries, extra] of [
    ['traversal', [{...config.entries[0], path: '../ESCAPED'}], {}],
    ['git-metadata', [{...config.entries[0], path: '.git/config'}], {}],
    ['duplicate-entry', [config.entries[0], config.entries[0]], {}],
    ['link-ancestor', [config.entries[1], {...config.entries[0], path: 'contained/child'}], {}],
    ['wrong-platform', [config.entries[0]], {pathProfile: {...ARCHIVE_PATH_PROFILE, platform: 'win32'}}],
    ['wrong-size-header', [{...config.entries[0], bytes: config.entries[0].bytes + 1}], {}],
    ['missing-object-header', [{...config.entries[0], blob: '0'.repeat(40)}], {}],
    ['escaping-link', [{path: 'escape', mode: '120000', blob: config.escapingBlob, bytes: config.escapingBytes}], {}],
  ]) await check(id, async () => {
    const options = {...input(entries), ...extra}; const refusal = await refuse(id, () => extractCommitted(options));
    assert.equal(existsSync(join(config.target, 'ESCAPED')), false);
    return {input: {entries, pathProfile: options.pathProfile}, refusal, destinationExists: existsSync(options.destination)};
  });
} finally {
  writeFileSync(join(config.target, 'probe.json'), JSON.stringify(report, null, 2) + '\n', {flag: 'wx'});
  console.log(JSON.stringify(report)); process.disconnect();
  process.exitCode = report.controls.some(row => row.status !== 'PASS') ? 1 : 0;
}
