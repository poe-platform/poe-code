import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const privateRoot = '/tmp/safe-bash-stream-verifier-20260827-A';
const target = readFileSync(join(privateRoot, 'latest-snapshot.txt'), 'utf8').trim();
const gatePath = process.argv[3] ?? '/tmp/safe-bash-stream-batch-review.ready';
const gate = readFileSync(gatePath, 'utf8');
if (!gate.includes('CLOSED')) throw Error('Author not closed');
const manifest = JSON.parse(readFileSync(join(target, 'SNAPSHOT.json'), 'utf8'));
if (manifest.gate !== gate) throw Error('Review gate changed');
const mode = process.argv[2];
if (!['original', 'native', 'contracts'].includes(mode)) throw Error('Specify original/native/contracts');
if (mode === 'native') {
  const originalApproval = readFileSync('/tmp/safe-bash-stream-batch-review.ready', 'utf8');
  if (!originalApproval.includes('Authorize TWO DISTINCT comparisons') || !originalApproval.includes('8082fe55e6f426d6ea76107abe27321aadd30046ad429c734c9123bc3c25e3ae')) throw Error('Distinct native profile needs root authorization');
}
const output = join(target, `run-${mode}`);
mkdirSync(output);
const contractPattern = '^(chunk ownership:|VFS |invocation-local limits|preabort |blocked |actual backpressure |literal invoke |complex byte pipeline |shared shell output |tac and strings bound |factory |raw object marker |internal pipe binary )';
const argv = ['--unhandled-rejections=strict', '--import', 'tsx', '--test', '--test-concurrency=1', '--test-reporter=tap', `--test-name-pattern=${mode === 'contracts' ? contractPattern : '^frozen fixture:'}`, 'tests/commands/stream-inspection-stress/holdouts.test.ts'];
const environment = { PATH: '/usr/bin:/bin', LC_ALL: 'C', TZ: 'UTC', HOME: output, STREAM_HOLDOUT_DIR: privateRoot, STREAM_RESULTS_DIR: output, STREAM_PROFILE: mode === 'native' ? 'native' : 'original', TSX_DISABLE_CACHE: '1', TSX_TSCONFIG_PATH: join(target, 'tsconfig.json') };
const started = new Date().toISOString();
writeFileSync(join(output, 'attempt.json'), JSON.stringify({ started, argv, environment, target, runtime: manifest.runtime }, null, 2) + '\n', { flag: 'wx' });
const result = spawnSync(process.execPath, argv, { cwd: target, env: environment, timeout: 90000, maxBuffer: 16 * 1024 * 1024, encoding: 'utf8' });
writeFileSync(join(output, 'stdout.tap'), result.stdout ?? '', { flag: 'wx' });
writeFileSync(join(output, 'stderr.txt'), result.stderr ?? '', { flag: 'wx' });
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const summary = { started, ended: new Date().toISOString(), status: result.status, signal: result.signal, error: result.error?.message ?? null, stdoutSha256: hash(result.stdout ?? ''), stderrSha256: hash(result.stderr ?? ''), runtimeSha256After: hash(readFileSync(process.execPath)), mode, target };
writeFileSync(join(output, 'result.json'), JSON.stringify(summary, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify(summary, null, 2));
console.log((result.stdout ?? '').split('\n').filter(line => /^(not ok|# tests|# pass|# fail|# cancelled|# skipped)/.test(line)).join('\n'));
process.exitCode = result.error || result.signal ? 2 : result.status ?? 2;
