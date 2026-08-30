import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const directory = '/tmp/safe-bash-stream-verifier-20260827-A';
const executable = '/tmp/safe-bash-gnu-strings-20260827-YJqPHf/build-system-zlib/binutils/strings';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const frozen = JSON.parse(readFileSync(join(directory, 'FROZEN.json'), 'utf8'));
for (const name of ['cases.json', 'native-controls.json', 'intent.json']) {
  if (hash(readFileSync(join(directory, name))) !== frozen.hashes[name]) throw Error(`Freeze mismatch: ${name}`);
}
const executableHash = hash(readFileSync(executable));
if (executableHash !== '90b9c9257095110594ae58a4bb1531d9670bd6aed297b8dbf0dc01914c5de09f') throw Error('Executable mismatch');
const environment = { PATH: '/usr/bin:/bin', LC_ALL: 'C', TZ: 'UTC' };
const version = spawnSync(executable, ['--version'], { env: environment, encoding: 'utf8', timeout: 3000 });
if (version.status !== 0 || version.error) throw Error('Version failed');
const cases = JSON.parse(readFileSync(join(directory, 'cases.json'), 'utf8')).filter(item => item.command === 'strings');
if (cases.length !== 20) throw Error('Wrong cohort');
const output = join(directory, 'gnu-strings-supplement');
mkdirSync(output);
const captures = [];
for (const item of cases) {
  const cwd = join(output, item.id);
  mkdirSync(cwd);
  for (const [name, bytes] of Object.entries(item.files)) writeFileSync(join(cwd, name), Buffer.from(bytes, 'hex'), { flag: 'wx' });
  const result = spawnSync(executable, item.args, { cwd, input: Buffer.from(item.stdinHex, 'hex'), env: environment, timeout: 3000, maxBuffer: 4 * 1024 * 1024 });
  const expected = { stdoutHex: result.stdout?.toString('hex'), stderrHex: result.stderr?.toString('hex'), exitCode: result.status };
  const differences = Object.keys(expected).filter(field => item.expected[field] !== null && item.expected[field] !== expected[field]);
  const capture = { id: item.id, args: item.args, locale: item.locale, inputSha256: hash(Buffer.from(item.stdinHex, 'hex')), fileHashes: Object.fromEntries(Object.entries(item.files).map(([name, bytes]) => [name, hash(Buffer.from(bytes, 'hex'))])), originalExpected: item.expected, expected, differences, signal: result.signal, error: result.error?.message ?? null };
  captures.push(capture);
  writeFileSync(join(output, `${item.id}.json`), JSON.stringify(capture, null, 2) + '\n', { flag: 'wx' });
}
const report = { capturedAt: new Date().toISOString(), beforeFreshReviewerProductSourceInspection: true, predecessorExposure: 'Preparation leaf did limited author source safety review after original freeze; no module execution', corpusSha256: frozen.hashes['cases.json'], executable, resolvedExecutable: realpathSync(executable), executableHash, executableHashAfter: hash(readFileSync(executable)), configuration: '--enable-default-strings-all; DEFAULT_STRINGS_ALL=1; existing system zlib/libSystem', version, platform: process.platform, arch: process.arch, node: process.version, environment, argv: process.argv, count: captures.length, captures };
writeFileSync(join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
const hashes = Object.fromEntries(captures.map(item => [`${item.id}.json`, hash(readFileSync(join(output, `${item.id}.json`)))]));
hashes['report.json'] = hash(readFileSync(join(output, 'report.json')));
writeFileSync(join(output, 'SHA256.json'), JSON.stringify(hashes, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ count: captures.length, faults: captures.filter(item => item.error || item.signal || item.expected.exitCode === null), conflicts: captures.filter(item => item.differences.length), reportSha256: hashes['report.json'] }, null, 2));
