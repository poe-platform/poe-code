import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { chmod, lstat, mkdir, mkdtemp, readFile, readdir, readlink, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import { runChild, sha256 } from '../current-shell/support.mjs';
import { binaryProfiles, cases, initialFiles, invocation } from './cases.mjs';

export const owned = dirname(fileURLToPath(import.meta.url));
const root = resolve(owned, '../../..');
const helperPath = 'tests/shell-stress/current-shell/support.mjs';
const helperHash = 'd7b278db709f869a03e5cce56c501011a1162465b03ecfc1663465b0163c6f8a';
const catHash = '580599dd318fa34bb0f91c29106894852c49c3a3df724b637113df95c6758fe6';

export function saveNewJson(filename, value) {
  assert.match(filename, /^[a-z0-9-]+\.json$/u);
  const target = resolve(owned, filename);
  assert.equal(existsSync(target), false, 'Refusing to overwrite evidence');
  const content = `${JSON.stringify(value, null, 2)}\n`;
  execFileSync('apply_patch', [], { cwd: root, input: `*** Begin Patch\n*** Add File: ${relative(root, target)}\n${content.trimEnd().split('\n').map(line => `+${line}`).join('\n')}\n*** End Patch\n`, maxBuffer: 8 * 1024 * 1024 });
}

export async function snapshot(directory) {
  const entries = {};
  async function visit(current) {
    for (const name of (await readdir(current)).sort()) {
      const target = resolve(current, name);
      const stat = await lstat(target);
      const key = relative(directory, target);
      const mode = stat.mode & 0o7777;
      if (stat.isDirectory()) { entries[key] = { kind: 'directory', mode }; await visit(target); }
      else if (stat.isFile()) entries[key] = { kind: 'file', mode, bytes: (await readFile(target)).toString('base64') };
      else if (stat.isSymbolicLink()) entries[key] = { kind: 'symlink', mode, target: await readlink(target) };
      else throw new Error(`Unexpected fixture kind: ${key}`);
    }
  }
  await visit(directory);
  return entries;
}

export function complete(result) {
  assert.equal(result.timedOut, false);
  assert.equal(result.overflow, false);
  assert.equal(result.groupAlive, false);
  assert.equal(result.signal, null);
  assert.ok(Number.isInteger(result.status));
}

async function guardedTools() {
  const files = { [helperPath]: sha256(await readFile(resolve(root, helperPath))), '/bin/cat': sha256(await readFile('/bin/cat')) };
  assert.equal(files[helperPath], helperHash);
  assert.equal(files['/bin/cat'], catHash);
  for (const profile of binaryProfiles) {
    files[profile.path] = sha256(await readFile(profile.path));
    assert.equal(files[profile.path], profile.sha256);
  }
  return files;
}

export const controlScript = `printf 'name=%s\nversion=%s\n' "$0" "$BASH_VERSION"
set -o
set -e
value=$(set -o)
printf 'substitution-options-begin\n%s\nsubstitution-options-end\n' "$value"
bash -c 'printf "bash-child=%s:%s\\n" "$0" "$BASH_VERSION"; set -o' child
sh -c 'printf "sh-child=%s:%s\\n" "$0" "$BASH_VERSION"; set -o' child
printf '\\000\\377'
`;

export async function capture() {
  const before = await guardedTools();
  const suite = { schema: 1, kind: 'native-only-hidden-errexit-freeze', startedAt: new Date().toISOString(), sourceProvenance: null, sourceClaim: 'No product import or implementation inspection; native observations only.', host: { platform: os.platform(), release: os.release(), version: os.version(), arch: os.arch(), node: process.version, nodePath: process.execPath }, caseFileSha256: sha256(await readFile(resolve(owned, 'cases.mjs'))), limits: { deadlineMs: 3000, combinedOutputBytes: 1048576, serial: true, groupSignal: 'SIGKILL', ambientNetworkCapability: false, note: 'No networking commands; scrubbed environment is not an OS network sandbox.' }, before, profiles: [] };
  const scratch = await realpath(await mkdtemp(resolve(owned, '.native-')));
  try {
    for (const binary of binaryProfiles) {
      const roles = resolve(scratch, `${binary.id}-roles`);
      await mkdir(roles);
      for (const role of ['bash', 'sh']) await symlink(binary.path, resolve(roles, role));
      await symlink('/bin/cat', resolve(roles, 'cat'));
      const env = { PATH: roles, HOME: '/nonexistent', LANG: 'C', LC_ALL: 'C', TZ: 'UTC' };
      const versionArgs = ['--version'];
      const version = await runChild(binary.path, versionArgs, { cwd: scratch, env, deadline: 3000, argv0: 'bash' });
      complete(version); assert.equal(version.status, 0);
      for (const role of ['bash', 'sh']) {
        const profile = { id: `${binary.id}-${role}-C`, binary, role, locale: 'C', cwdRoot: scratch, env, roleFixtures: { bash: { target: binary.path, sha256: binary.sha256 }, sh: { target: binary.path, sha256: binary.sha256 }, cat: { target: '/bin/cat', sha256: catHash } }, version: { executable: binary.path, argv0: 'bash', args: versionArgs, cwd: scratch, env, stdin: '', result: version }, controls: {}, rows: [] };
        const control = { argv0: role, args: ['--noprofile', '--norc', '-c', controlScript, 'shell'], stdin: '', cwd: scratch, env };
        control.result = await runChild(binary.path, control.args, { ...control, deadline: 3000 });
        complete(control.result); assert.equal(control.result.status, 0); assert.equal(control.result.stderr, '');
        const controlBytes = Buffer.from(control.result.stdout, 'base64');
        const text = controlBytes.subarray(0, -2).toString();
        assert.deepEqual([...controlBytes.subarray(-2)], [0, 255]);
        assert.ok(text.startsWith(`name=shell\nversion=${binary.versionPrefix}`));
        const substitutionOptions = text.split('substitution-options-begin\n')[1].split('\nsubstitution-options-end')[0];
        assert.match(substitutionOptions, new RegExp(`^errexit\\s+${role === 'bash' ? 'off' : 'on'}$`, 'mu'));
        const posix = [...text.matchAll(/^posix\s+(on|off)$/gmu)].map(match => match[1]);
        assert.deepEqual(posix, [role === 'sh' ? 'on' : 'off', role === 'sh' ? 'on' : 'off', 'off', 'on']);
        for (const childRole of ['bash', 'sh']) assert.ok(text.includes(`${childRole}-child=child:${binary.versionPrefix}`));
        profile.controls = { ...control, checks: { name: true, binaryVersion: true, commandSubstitutionRole: true, posixModes: posix, rawNulAndNonUtf8: true, bothChildRoles: true } };
        for (const specimen of cases) {
          const cwd = resolve(scratch, `${profile.id}-${specimen.id}`);
          await mkdir(cwd);
          for (const [name, fixture] of Object.entries(initialFiles(specimen))) { await writeFile(resolve(cwd, name), fixture.text); await chmod(resolve(cwd, name), fixture.mode); }
          const initial = await snapshot(cwd);
          const launch = invocation(specimen, role);
          const result = await runChild(binary.path, launch.args, { cwd, env, argv0: launch.argv0, stdin: launch.stdin, deadline: 3000 });
          complete(result);
          profile.rows.push({ id: specimen.id, sourceSha256: sha256(specimen.script), executable: binary.path, ...launch, cwd, env, initial, result, effects: await snapshot(cwd) });
          await rm(cwd, { recursive: true });
        }
        suite.profiles.push(profile);
      }
    }
  } finally { await rm(scratch, { recursive: true, force: true }); }
  suite.after = await guardedTools();
  assert.deepEqual(suite.after, before);
  suite.scratchRemoved = !existsSync(scratch);
  suite.finishedAt = new Date().toISOString();
  return suite;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const filename = process.argv[2] ?? 'native-frozen.json';
  assert.equal(existsSync(resolve(owned, filename)), false);
  const suite = await capture();
  saveNewJson(filename, suite);
  console.log(JSON.stringify({ profiles: suite.profiles.map(profile => ({ id: profile.id, observations: profile.rows.length, launcherControls: 1 })), observations: suite.profiles.reduce((total, profile) => total + profile.rows.length, 0), cleanup: suite.scratchRemoved, sha256: sha256(await readFile(resolve(owned, filename))) }));
}
