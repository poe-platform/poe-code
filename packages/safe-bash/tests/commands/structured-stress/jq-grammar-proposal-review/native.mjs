import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { arch, platform, release } from 'node:os';

const directory = dirname(fileURLToPath(import.meta.url));
const root = resolve(directory, '../../../..');
const author = resolve(directory, '../jq-grammar-author-20260827');
const read = path => JSON.parse(readFileSync(path));
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const proposal = read(resolve(author, 'planned-test-only-changes-v2.json'));
const proofs = [...proposal.proposal, ...proposal.supplemental].flatMap(row => (Array.isArray(row.nativeProof) ? row.nativeProof : [row.nativeProof]).map(proof => ({ ...proof, row: row.oldTestName, kind: 'planned-constituent' })));
const frozen = read(resolve(author, 'native-frozen.json'));
const safety = readFileSync(resolve(root, 'tests/commands/structured-stress/safety.test.ts'), 'utf8');
const malformed = runInNewContext(`(${safety.match(/const malformed = (\[[\s\S]*?\n\]);/u)[1]})`);
const extras = malformed.flatMap((input, index) => {
  const inputHex = Buffer.from(input).toString('hex');
  if (proofs.some(proof => JSON.stringify(proof.argv) === '["-c","."]' && proof.inputHex === inputHex)) return [];
  const vector = frozen.vectors.find(vector => JSON.stringify(vector.argv) === '["-c","."]' && vector.inputHex === inputHex);
  return [{ id: `unchanged-malformed-neighbor-${index}`, argv: ['-c', '.'], inputHex, files: {}, expected: vector?.expected, frozenId: vector?.id, kind: 'shared-loop-neighbor', row: `malformed array index ${index}` }];
});
const defaultInputs = proofs.filter(proof => proof.id.startsWith('resource-filter-')).map(proof => ({ ...proof, id: `${proof.id}-actual-default-input`, inputHex: Buffer.from('null').toString('hex'), kind: 'canonical-default-input-control' }));
const vectors = [...proofs, ...extras, ...defaultInputs];
const environment = { PATH: '/usr/bin:/bin', LC_ALL: 'C', LANG: 'C', TZ: 'UTC', NO_COLOR: '1' };
const executable = '/usr/bin/jq';
const executableSha256 = digest(readFileSync(executable));
const scratchName = `.native-${Date.now()}`;
const scratch = resolve(directory, scratchName);
const marker = `tests/commands/structured-stress/jq-grammar-proposal-review/${scratchName}/marker.txt`;
const patch = text => {
  const result = spawnSync('apply_patch', [], { cwd: root, input: text, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
};
patch(`*** Begin Patch\n*** Add File: ${marker}\n+Isolated native oracle working directory.\n*** End Patch\n`);
const snapshot = () => Object.fromEntries(readdirSync(scratch).sort().map(name => [name, digest(readFileSync(resolve(scratch, name)))]));
const beforeFiles = snapshot();
const tuple = result => ({ status: result.status, stdoutHex: result.stdout.toString('hex'), stderrHex: result.stderr.toString('hex') });
const invoke = async vector => {
  const files = Object.entries(vector.files ?? {});
  if (!files.length) {
    const result = spawnSync(executable, vector.argv, { cwd: scratch, env: environment, shell: false, input: Buffer.from(vector.inputHex, 'hex'), timeout: 5000, maxBuffer: 256 * 1024 });
    assert.ifError(result.error);
    assert.equal(result.signal, null);
    return { actual: tuple(result), executedArgv: vector.argv, route: 'literal-argv-stdin' };
  }
  assert.equal(files.length, 1);
  assert.equal(files[0][0], 'unicode-start');
  assert.equal(files[0][1], 'f09f');
  const executedArgv = vector.argv.map(arg => arg === files[0][0] ? '/dev/fd/3' : arg);
  const result = await new Promise((resolveResult, rejectResult) => {
    const child = spawn(executable, executedArgv, { cwd: scratch, env: environment, shell: false, stdio: ['pipe', 'pipe', 'pipe', 'pipe'] });
    const stdout = [];
    const stderr = [];
    let total = 0;
    const timer = setTimeout(() => { child.kill('SIGKILL'); rejectResult(new Error('native fd route timeout')); }, 5000);
    const collect = target => bytes => {
      total += bytes.length;
      if (total > 256 * 1024) { child.kill('SIGKILL'); rejectResult(new Error('capture cap exceeded')); }
      target.push(bytes);
    };
    child.on('error', rejectResult);
    child.stdout.on('data', collect(stdout));
    child.stderr.on('data', collect(stderr));
    child.on('close', (status, signal) => { clearTimeout(timer); if (signal) rejectResult(new Error(signal)); else resolveResult({ status, stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr) }); });
    child.stdin.on('error', rejectResult);
    child.stdio[3].on('error', rejectResult);
    child.stdio[3].end(Buffer.from(files[0][1], 'hex'));
    child.stdin.end(Buffer.from(vector.inputHex, 'hex'));
  });
  return { actual: tuple(result), executedArgv, route: 'binary-file-input-via-inherited-fd', limitation: 'Text-only apply_patch cannot create the invalid UTF-8 regular file. /dev/fd/3 preserves separate source bytes/EOF/order, NOT the literal filename, regular-file type, seekability or VFS effects. Frozen literal-file expectations remain authoritative; this is a separately labeled transport control.' };
};
const startedAt = new Date().toISOString();
const version = await invoke({ argv: ['--version'], inputHex: '' });
const build = await invoke({ argv: ['--build-configuration'], inputHex: '' });
const results = [];
for (const vector of vectors) {
  const first = await invoke(vector);
  const second = await invoke(vector);
  assert.deepEqual(first, second, `${vector.id}: unstable native repeat`);
  results.push({ ...vector, ...first, repeatIdentical: true, matchesFrozen: vector.expected ? JSON.stringify(first.actual) === JSON.stringify(vector.expected) : null });
}
assert.deepEqual(snapshot(), beforeFiles, 'native directory mutation');
assert.equal(digest(readFileSync(executable)), executableSha256);
const report = { startedAt, endedAt: new Date().toISOString(), executable, executableSha256, version, build, environment, host: { node: process.version, platform: platform(), release: release(), arch: arch() }, cwd: scratch, captureSha256: digest(readFileSync(fileURLToPath(import.meta.url))), repeats: 2, invocations: 2 + 2 * vectors.length, beforeFiles, afterFiles: snapshot(), proposalSha256: digest(readFileSync(resolve(author, 'planned-test-only-changes-v2.json'))), results, limits: 'Native-only. No product import. Chunk schedules, product quotas, cancellation, VFS mutation safety and shell pipelines are not established by these direct native processes. fd variants are not literal-file reruns.' };
const output = resolve(directory, 'native-review.json');
assert.ok(!existsSync(output));
patch(`*** Begin Patch\n*** Add File: tests/commands/structured-stress/jq-grammar-proposal-review/native-review.json\n${JSON.stringify(report, null, 2).split('\n').map(line => `+${line}`).join('\n')}\n*** Delete File: ${marker}\n*** End Patch\n`);
console.log(JSON.stringify({ vectors: results.length, planned: proofs.length, neighbors: extras.length, actualDefaultInputs: defaultInputs.length, invocations: report.invocations, mismatches: results.filter(result => result.matchesFrozen === false).map(result => result.id), missingFrozen: results.filter(result => result.matchesFrozen === null).map(result => result.id), fdVariants: results.filter(result => result.route !== 'literal-argv-stdin').map(result => result.id) }));
