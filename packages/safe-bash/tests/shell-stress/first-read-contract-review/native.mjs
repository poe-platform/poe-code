import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, readdirSync, realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { capture, owned, cleanEnv } from './supervisor.mjs';

const bash = '/tmp/safe-bash-gnu-bash-5.3.Ua5t02/install/bin/bash';
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const bashHash = sha256(readFileSync(bash));
assert.equal(bashHash, '8cecb482de24198c23a736b931cb7e8cee1f94eb0b51abd54bd99f1d73d9673c');
const profileScript = 'umask 022; printf "BASH_VERSION=%s\\nMACHTYPE=%s\\n" "$BASH_VERSION" "$MACHTYPE"; printf "umask="; umask; type printf : test; printf "SIGPIPE="; kill -l PIPE; /usr/bin/uname -srm; /usr/bin/sw_vers; /usr/bin/locale; shopt lastpipe; set -o; exit 0';
const profile = await capture('native-profile', bash, ['--noprofile', '--norc', '-c', profileScript], { cwd: owned, timeoutMs: 3000, maxBytes: 65536 });
assert.match(profile.stdout, /BASH_VERSION=5\.3\.0\(1\)-release/);
const toolPaths = [bash, '/bin/sleep', '/bin/ps', '/usr/bin/uname', '/usr/bin/sw_vers', '/usr/bin/locale'];
writeFileSync(resolve(owned, 'evidence/native-tools.json'), JSON.stringify({ bash, bashHash, env: cleanEnv,
  tools: toolPaths.map(path => ({ path, realpath: realpathSync(path), sha256: sha256(readFileSync(path)) })),
  versions: { bash: '5.3.0(1)-release', printf: 'GNU Bash 5.3 builtin', consumer: 'GNU Bash function using :/printf builtins',
    sleep: 'Darwin system /bin/sleep; no independent version CLI asserted; binary hash + captured macOS version pin it',
    localeAndPs: 'Darwin system tools; binary hashes + captured OS profile, not GNU coreutils' },
  nativeProfile: 'GNU Bash 5.3 on Darwin arm64, NOT GNU/Linux or Apple Bash 3.2. No head binary used.' }, null, 2) + '\n', { flag: 'wx' });

const waitClosed = 'for attempt in {1..100}; do [[ -f closed ]] && break; /bin/sleep 0.01; done; [[ -f closed ]] || exit 98; /bin/sleep 0.05;';
const waitPrepared = 'for attempt in {1..100}; do [[ -f prepared ]] && break; /bin/sleep 0.01; done; [[ -f prepared ]] || exit 99;';
const cases = [
  { id: 'C3', producer: `printf prepared > effect; printf ready > prepared; ${waitClosed} printf 'payload\\n';`, consumer: waitPrepared, stdout: '', stderr: '', status: 141, effect: 'prepared' },
  { id: 'C4', producer: `${waitClosed} printf kept > effect;`, consumer: '', stdout: '', stderr: '', status: 0, effect: 'kept' },
  { id: 'C5', producer: `${waitClosed} :;`, consumer: '', stdout: '', stderr: '', status: 0 },
  { id: 'C6', producer: `${waitClosed} printf 'delayed-error\\n' >&2; return 7;`, consumer: '', stdout: '', stderr: 'delayed-error\n', status: 7 },
  { id: 'C7', producer: `printf 'diagnostic\\n' >&2; printf ready > prepared; ${waitClosed} printf 'payload\\n';`, consumer: waitPrepared, stdout: '', stderr: 'diagnostic\n', status: 141 },
];
const results = [];
for (const entry of cases) {
  const cwd = resolve(owned, `.scratch/native-${entry.id}`);
  mkdirSync(cwd, { recursive: false });
  const script = `umask 022\nset -o pipefail\nproducer() { ${entry.producer} }\nconsumer() { ${entry.consumer} printf closed > closed; :; }\nproducer | consumer\noutcome=( "$?" "\${PIPESTATUS[@]}" )\nprintf '%s\\n' "\${outcome[*]}" > statuses\nexit "\${outcome[0]}"\n`;
  writeFileSync(resolve(owned, `evidence/native-${entry.id}.bash-data`), script, { flag: 'wx' });
  const captured = await capture(`native-${entry.id}`, bash, ['--noprofile', '--norc', '-c', script], { cwd, timeoutMs: 3000, maxBytes: 65536 });
  const effects = Object.fromEntries(readdirSync(cwd).sort().map(name => [name, { text: readFileSync(resolve(cwd, name), 'utf8'), sha256: sha256(readFileSync(resolve(cwd, name))) }]));
  const failures = [];
  for (const [field, expected] of [['stdout', entry.stdout], ['stderr', entry.stderr], ['status', entry.status]]) {
    if (captured[field] !== expected) failures.push({ field, expected, actual: captured[field] });
  }
  if (entry.effect !== undefined && effects.effect?.text !== entry.effect) failures.push({ field: 'effect', expected: entry.effect, actual: effects.effect });
  if (effects.statuses?.text !== `${entry.status} ${entry.status} 0\n`) failures.push({ field: 'PIPESTATUS', actual: effects.statuses });
  results.push({ id: entry.id, verdict: failures.length ? 'FAIL' : 'PASS', failures, effects, scriptSha256: sha256(script), childReaped: captured.closeEventObserved && !captured.groupExistsAfterClose, comparisons: 'Meaningful output/status/effects; no JavaScript demand analogue' });
}
writeFileSync(resolve(owned, 'evidence/native-results.json'), JSON.stringify(results, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify(results.map(({ id, verdict, failures }) => ({ id, verdict, failures }))));
if (results.some(result => result.verdict !== 'PASS')) process.exitCode = 1;
