import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, symlinkSync, mkdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import os from 'node:os';

const root = mkdtempSync('/tmp/sb-e-design-');
const profiles = [
  { name: 'gnu53', binary: '/tmp/safe-bash-gnu-bash-5.3.Ua5t02/install/bin/bash' },
  { name: 'apple32', binary: '/bin/bash' },
];
const digest = path => createHash('sha256').update(readFileSync(path)).digest('hex');
const raw = bytes => ({ text: bytes.toString('utf8'), base64: bytes.toString('base64') });
async function run(binary, args, cwd, env, argv0 = 'bash', input = '') {
  return await new Promise((resolve, reject) => {
    const child = spawn(binary, args, { cwd, env, argv0, detached: true, stdio: ['pipe', 'pipe', 'pipe'] });
    const stdout = [], stderr = [];
    let total = 0, timedOut = false, overflow = false;
    const stop = () => { try { process.kill(-child.pid, 'SIGKILL'); } catch {} };
    const timer = setTimeout(() => { timedOut = true; stop(); }, 2000);
    const capture = destination => chunk => { total += chunk.length; destination.push(chunk); if (total > 65536) { overflow = true; stop(); } };
    child.stdout.on('data', capture(stdout)); child.stderr.on('data', capture(stderr));
    child.stdin.on('error', () => {}); child.stdin.end(input);
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('close', (status, signal) => {
      clearTimeout(timer); stop();
      resolve({ status, signal, timedOut, overflow, stdout: raw(Buffer.concat(stdout)), stderr: raw(Buffer.concat(stderr)) });
    });
  });
}
const cases = [
  ['simple', 'set -e; false; printf BAD > marker'],
  ['disable', 'set -e; set +e; false; printf after'],
  ['conditional-function', 'f() { set -e; printf "flags=%s\\n" "$-"; false; printf body; }; if f; then printf yes; fi; false; printf BAD'],
  ['and-or', 'set -e; false && printf BAD; false || printf recovered; true && false; printf BAD'],
  ['group-ignored-result', 'set -e; { false && true; }; printf after'],
  ['function-ignored-result', 'set -e; f() { false && true; }; f; printf after'],
  ['subshell-ignored-result', 'set -e; (false && true); printf BAD'],
  ['while-until', 'set -e; while false; do printf BAD; done; until true; do printf BAD; done; ! true; printf after'],
  ['eval-tested', 'set -e; eval "false; printf body" || printf rescue; printf after'],
  ['source-tested', 'set -e; . ./body || printf rescue; printf after'],
  ['source-normal', 'set -e; . ./body; printf BAD'],
  ['subshell-normal', 'set -e; (false; printf BAD); printf BAD'],
  ['subshell-tested', 'set -e; (false; printf body) || printf rescue; printf after'],
  ['substitution-default', 'set -e; value=$(false; printf body); printf "value=%s" "$value"'],
  ['substitution-tested', 'set -e; value=$(false; printf body) || printf rescue; printf "value=%s" "$value"'],
  ['substitution-enable', 'value=$(set -e; false; printf BAD); printf "status=%s value=%s" "$?" "$value"'],
  ['pipeline-stage', 'set -e; { false; printf BAD > marker; } | cat; printf after'],
  ['pipeline-pipefail', 'set -e; set -o pipefail; { false; printf BAD > marker; } | cat; printf BAD'],
  ['pipeline-tested', 'set -e; { false; printf body; } | cat || printf rescue; printf after'],
  ['explicit-exit-tested', 'set -e; f() { exit 7; }; if f; then printf BAD; fi; printf BAD'],
  ['return-tested', 'set -e; f() { return 7; }; if f; then printf BAD; fi; printf after'],
  ['new-bash-reset', 'set -e; bash -c "false; printf child"; printf after'],
  ['new-bash-tested', 'set -e; bash -ec "false; printf BAD" || printf rescue; printf after'],
  ['headerless-inherits', 'set -e; ./headerless; printf BAD'],
];
const options = [
  ['ec', ['-ec', 'false; printf BAD', 'named']],
  ['ce', ['-ce', 'false; printf BAD', 'named']],
  ['clear', ['-e', '+e', '-c', 'false; printf after']],
  ['after-c', ['-c', '-e', 'false; printf BAD', 'named']],
  ['stdin-es', ['-es', '--', '-arg'], 'printf "arg=%s\\n" "$1"; false; printf BAD'],
  ['file-e', ['-e', './body', 'arg']],
  ['set-combined', ['-c', 'set -e -- arg; printf "%s" "$1"; false; printf BAD']],
  ['set-o', ['-c', 'set -o errexit; false; printf BAD']],
  ['plus-c', ['+c', 'printf after']],
];
const evidence = { root, platform: process.platform, release: os.release(), architecture: process.arch, locale: 'C', profiles: [], cases, options, rows: [], shebang: [] };
for (const profile of profiles) {
  const version = execFileSync(profile.binary, ['--version'], { env: { LC_ALL: 'C', PATH: '/usr/bin:/bin' }, timeout: 2000 }).toString();
  evidence.profiles.push({ ...profile, sha256: digest(profile.binary), version });
  for (const mode of ['bash', 'sh']) for (const [id, source] of cases) {
    const cwd = mkdtempSync(`${root}/case-`); mkdirSync(`${cwd}/roles`);
    symlinkSync(profile.binary, `${cwd}/roles/bash`); symlinkSync('/bin/cat', `${cwd}/roles/cat`);
    writeFileSync(`${cwd}/body`, 'false; printf body\n');
    writeFileSync(`${cwd}/headerless`, 'false; printf BAD > marker\n', { mode: 0o755 });
    const env = { PATH: `${cwd}/roles`, HOME: cwd, LC_ALL: 'C', LANG: 'C', TZ: 'UTC' };
    const args = ['--noprofile', '--norc', '-c', source, 'shell'];
    const result = await run(profile.binary, args, cwd, env, mode);
    evidence.rows.push({ profile: profile.name, mode, id, args, env, cwd, ...result, marker: existsSync(`${cwd}/marker`) ? raw(readFileSync(`${cwd}/marker`)) : null });
  }
  for (const [id, args, input] of options) {
    const cwd = mkdtempSync(`${root}/option-`); writeFileSync(`${cwd}/body`, 'false; printf BAD\n');
    const env = { PATH: '/usr/bin:/bin', HOME: cwd, LC_ALL: 'C', LANG: 'C' };
    evidence.rows.push({ profile: profile.name, mode: 'bash', id: `option-${id}`, args, env, cwd, ...await run(profile.binary, ['--noprofile', '--norc', ...args], cwd, env, 'bash', input) });
  }
}
const recorderSource = '#include <stdio.h>\n#include <string.h>\nint main(int count, char **arguments) { printf("argc=%d\\n", count); for (int index=0;index<count;index++) { printf("%d:%zu:",index,strlen(arguments[index])); for (unsigned char *cursor=(unsigned char *)arguments[index];*cursor;cursor++) printf("%02x",*cursor); putchar(10); } return 0; }\n';
writeFileSync(`${root}/recorder.c`, recorderSource);
execFileSync('/usr/bin/cc', [`${root}/recorder.c`, '-o', `${root}/recorder`], { timeout: 8000 });
evidence.recorder = { source: recorderSource, binary: `${root}/recorder`, sha256: digest(`${root}/recorder`), compiler: execFileSync('/usr/bin/cc', ['--version'], { timeout: 2000 }).toString() };
evidence.envTool = { path: '/usr/bin/env', sha256: digest('/usr/bin/env') };
for (const profile of profiles) {
  const cwd = mkdtempSync(`${root}/shebang-`); mkdirSync(`${cwd}/roles`); symlinkSync(`${root}/recorder`, `${cwd}/roles/bash`);
  const env = { PATH: `${cwd}/roles`, HOME: cwd, LC_ALL: 'C', LANG: 'C' };
  for (const [id, shebang] of [ ['kernel-spaces', `${root}/recorder alpha beta`], ['kernel-quotes', `${root}/recorder "alpha beta"`], ['env-e-recorder', '/usr/bin/env bash -e'], ['env-S-recorder', '/usr/bin/env -S bash -e'], ['direct-bash-e', `${profile.binary} -e`] ]) {
    writeFileSync(`${cwd}/script`, `#!${shebang}\nfalse; printf BAD > marker\n`, { mode: 0o755 });
    const args = ['--noprofile', '--norc', '-c', './script tail', 'shell'];
    evidence.shebang.push({ profile: profile.name, id, shebang, args, cwd, env, ...await run(profile.binary, args, cwd, env), marker: existsSync(`${cwd}/marker`) ? raw(readFileSync(`${cwd}/marker`)) : null });
  }
  for (const [id, args] of [['env-single-explicit', ['bash -e', 'script', 'tail']], ['env-split-explicit', ['bash', '-e', 'script', 'tail']], ['env-S-explicit', ['-S', 'bash -e', 'script', 'tail']]]) {
    evidence.shebang.push({ profile: profile.name, id, args, cwd, env, ...await run('/usr/bin/env', args, cwd, env, 'env') });
  }
}
writeFileSync('/tmp/safe-bash-errexit-design-native.json', JSON.stringify(evidence, null, 2) + '\n');
for (const row of evidence.rows) console.log(`${row.profile}/${row.mode}/${row.id}: status=${row.status} stdout=${JSON.stringify(row.stdout.text)} stderr=${JSON.stringify(row.stderr.text)} marker=${JSON.stringify(row.marker?.text ?? null)}`);
for (const row of evidence.shebang) console.log(`${row.profile}/${row.id}: status=${row.status} stdout=${JSON.stringify(row.stdout.text)} stderr=${JSON.stringify(row.stderr.text)}`);
console.log(`evidence=/tmp/safe-bash-errexit-design-native.json rows=${evidence.rows.length} shebang=${evidence.shebang.length}`);
