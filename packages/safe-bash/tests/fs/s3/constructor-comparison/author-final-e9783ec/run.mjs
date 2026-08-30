import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, existsSync, symlinkSync } from 'node:fs';
import path from 'node:path';

const repository = '/Users/kjopek/Workspace/safe-bash';
const output = path.dirname(new URL(import.meta.url).pathname);
const git = (...args) => execFileSync('git', args, { cwd: repository, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }).trim();
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const saveFiles = files => {
  const patch = Object.entries(files).map(([name, text]) => `*** Add File: ${name}\n${text.replace(/\n$/, '').split('\n').map(line => '+' + line).join('\n')}\n`).join('');
  execFileSync('apply_patch', [], { cwd: output, input: `*** Begin Patch\n${patch}*** End Patch\n`, maxBuffer: 8 * 1024 * 1024 });
};
const save = (name, value) => saveFiles({ [name]: typeof value === 'string' ? value : JSON.stringify(value, null, 2) + '\n' });
const fixture = 'tests/fs/mount/identity-compatibility-review/compatibility.test.ts';
const original = 'tests/fs/mount/copy-identity.test.ts';
const required = ['tests/fs/mount/copy-identity-guards.test.ts', 'tests/fs/overlay/copy-identity.test.ts'];
const fixtures = [fixture, original, ...required, 'tests/fs/overlay/helpers.ts', 'tests/fs/webdav/mock.ts'];
const historical = JSON.parse(readFileSync(path.join(repository, 'tests/fs/mount/identity-compatibility-review/evidence/author-integration-eab1d48/manifest-before.json')));
const sources = git('ls-files', '--cached', '--others', '--exclude-standard', 'src').split('\n').filter(name => name.endsWith('.ts')).sort();
const inputs = [...sources, ...fixtures, 'package.json'];
const snapshot = () => {
  const contents = Object.fromEntries(inputs.map(name => [name, readFileSync(path.join(repository, name), 'utf8')]));
  const hashes = Object.fromEntries(Object.entries(contents).map(([name, text]) => [name, hash(text)]));
  for (const name of fixtures) assert.equal(hashes[name], historical.inputHashes[name], `Frozen fixture changed: ${name}`);
  return { contents, manifest: { head: git('rev-parse', 'HEAD'), captured: new Date().toISOString(), hashes,
    sourceSetSha256: hash(JSON.stringify(Object.fromEntries(sources.map(name => [name, hashes[name]])))),
    sourceStatus: git('status', '--short', '--', 'src/fs', 'src/contracts'), node: process.version } };
};
const probe = String.raw`import assert from 'node:assert/strict';
import { S3FileSystem, MockS3Client } from './src/fs/s3/index.ts';
import { WebDavFileSystem } from './src/fs/webdav/index.ts';
import { MockDav } from './tests/fs/webdav/mock.ts';
import { createMountFileSystem } from './src/fs/mount/index.ts';
import { MemoryFileSystem } from './src/fs/memory/index.ts';
import { FsError } from './src/contracts/errors.ts';
const payload = new Uint8Array([1, 2]);
const previous = new Uint8Array([9]);
let count = 0;
for (const kind of ['s3', 'webdav']) for (const phase of ['constructor', 'late']) {
  for (const scenario of ['same-distinct', 'distinct-alias', 'unknown-distinct', 'denied-alias', 'cancel-alias']) {
    const controller = new AbortController();
    const reason = new FsError('ENOENT', { message: 'controlled abort reason' });
    let calls = 0;
    let replacedCalls = 0;
    let filesystem;
    const callback = async function(ownPath, peer, peerPath, options) {
      calls++;
      assert.equal(this, filesystem);
      assert.equal(peer, filesystem);
      assert.equal(ownPath, '/source');
      assert.equal(peerPath, scenario.endsWith('alias') ? '/source' : '/target');
      assert.equal(options.signal, controller.signal);
      if (scenario === 'denied-alias') throw new FsError('EACCES');
      if (scenario === 'cancel-alias') { controller.abort(reason); return 'same'; }
      return scenario.startsWith('same') ? 'same' : scenario.startsWith('distinct') ? 'distinct' : 'unknown';
    };
    const selected = phase === 'constructor' ? callback : async () => { replacedCalls++; return 'distinct'; };
    let operations;
    if (kind === 's3') {
      const service = new MockS3Client({ buckets: ['bucket'] });
      await service.putObject({ Bucket: 'bucket', Key: 'source', Body: payload });
      await service.putObject({ Bucket: 'bucket', Key: 'target', Body: previous });
      filesystem = new S3FileSystem({ bucket: 'bucket', transport: service, compareEntry: selected });
      operations = () => service.requests.map(request => request.operation);
    } else {
      const service = new MockDav();
      service.files.set('/source', payload);
      service.files.set('/target', previous);
      filesystem = new WebDavFileSystem({ baseUrl: 'https://callback.invalid/dav/', fetch: service.createFetch(), compareEntry: selected });
      operations = () => service.requests.map(request => request.init.method);
    }
    if (phase === 'late') filesystem.compareEntry = callback;
    const mounted = createMountFileSystem({ root: new MemoryFileSystem(), mounts: { '/remote': filesystem } });
    const start = operations().length;
    const target = scenario.endsWith('alias') ? '/remote/source' : '/remote/target';
    const result = await mounted.compareEntry('/remote/source', mounted, target, { signal: controller.signal })
      .then(relation => ({ relation }), error => ({ code: error.code, error }));
    assert.equal(calls, 1);
    assert.equal(replacedCalls, 0);
    if (scenario === 'same-distinct') assert.equal(result.relation, 'same');
    else if (scenario === 'unknown-distinct') assert.equal(result.relation, 'unknown');
    else assert.equal(result.code, scenario === 'distinct-alias' ? 'EIO' : scenario === 'denied-alias' ? 'EACCES' : 'ENOENT');
    if (scenario === 'cancel-alias') assert.equal(result.error, reason);
    const trace = operations().slice(start);
    assert.ok(trace.every(operation => ['headObject', 'listObjectsV2', 'PROPFIND'].includes(operation)));
    assert.deepEqual(await filesystem.readFile('/source'), payload);
    assert.deepEqual(await filesystem.readFile('/target'), previous);
    assert.deepEqual(await filesystem.readdir('/'), [{ name: 'source', type: 'file' }, { name: 'target', type: 'file' }]);
    console.log(JSON.stringify({ kind, phase, scenario, relation: result.relation, code: result.code, calls, replacedCalls, trace, source: [...payload], target: [...previous] }));
    count++;
  }
}
console.log(JSON.stringify({ verified: count, failed: 0, classification: 'narrow author dispatch controls; not independent acceptance' }));
`;
const testArgs = ['--unhandled-rejections=strict', '--import', 'tsx', '--test', '--test-reporter=tap'];
const commands = [
  ['dispatch', ['--unhandled-rejections=strict', '--import', 'tsx', 'probe.mjs']],
  ['original43', [...testArgs, fixture]],
  ['original4', [...testArgs, original]],
  ['required49', [...testArgs, ...required]],
];
const rounds = existsSync(path.join(output, 'summary.json'))
  ? JSON.parse(readFileSync(path.join(output, 'summary.json'), 'utf8')).rounds : [];
const resumed = rounds.length > 0;
for (let attempt = rounds.length + 1; attempt <= 2; attempt++) {
  const label = `run-${attempt}`;
  const before = snapshot();
  save(`${label}/before.json`, before.manifest);
  saveFiles(Object.fromEntries([...Object.entries(before.contents).map(([name, text]) => [`${label}/snapshot/${name}`, text]), [`${label}/snapshot/probe.mjs`, probe]]));
  const workdir = path.join(output, label, 'snapshot');
  symlinkSync(path.join(repository, 'node_modules'), path.join(workdir, 'node_modules'), 'dir');
  const checks = [];
  for (const [name, args] of commands) {
    const commandBefore = snapshot().manifest;
    const started = new Date().toISOString();
    const result = spawnSync(process.execPath, args, { cwd: workdir, encoding: 'utf8', timeout: 120000, maxBuffer: 16 * 1024 * 1024 });
    const commandAfter = snapshot().manifest;
    const record = { name, executable: process.execPath, args, cwd: workdir, started, finished: new Date().toISOString(),
      status: result.status, signal: result.signal, error: result.error?.message ?? null, liveBefore: commandBefore, liveAfter: commandAfter,
      stdoutSha256: hash(result.stdout ?? ''), stderrSha256: hash(result.stderr ?? '') };
    save(`${label}/${name}.json`, record);
    save(`${label}/${name}.stdout`, result.stdout ?? '');
    save(`${label}/${name}.stderr`, result.stderr ?? '');
    const totals = Object.fromEntries([...(result.stdout ?? '').matchAll(/^# (tests|pass|fail|cancelled|skipped|todo) (\d+)$/gm)].map(match => [match[1], Number(match[2])]));
    checks.push({ name, status: result.status, totals });
    console.log(JSON.stringify({ attempt, name, status: result.status, totals }));
  }
  const after = snapshot();
  save(`${label}/after.json`, after.manifest);
  const changes = inputs.filter(name => before.manifest.hashes[name] !== after.manifest.hashes[name]);
  const originalStdout = readFileSync(path.join(output, label, 'original43.stdout'), 'utf8');
  const observations = originalStdout.split('\n').filter(line => line.startsWith('# {"case":')).map(line => JSON.parse(line.slice(2)));
  save(`${label}/original43.observations.json`, observations);
  const round = { attempt, beforeHead: before.manifest.head, afterHead: after.manifest.head, sourceSetSha256: before.manifest.sourceSetSha256,
    changes, stable: changes.length === 0, sourceStatus: after.manifest.sourceStatus, checks };
  rounds.push(round);
  save(`${label}/summary.json`, round);
  if (changes.length === 0) break;
  console.log(JSON.stringify({ retryReason: 'live source/input changed', changes }));
}
save(resumed ? 'summary-rerun.json' : 'summary.json', { classification: 'AUTHOR current-source integration only; not Dirac acceptance', repository, output, rounds });
console.log(JSON.stringify({ output, final: rounds.at(-1) }));
process.exitCode = rounds.at(-1).checks.some(check => check.status !== 0) || !rounds.at(-1).stable ? 1 : 0;
