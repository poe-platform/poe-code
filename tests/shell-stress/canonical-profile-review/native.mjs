import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { chmod, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { owned, rendering, runChild, save, sha256, snapshot, transport } from './support.mjs';

const inputs = JSON.parse(await readFile(resolve(owned, 'inputs.json')));
const output = process.argv[2] ?? 'native-frozen.json';
assert.match(output, /^[a-z0-9-]+\.json$/u);
assert.equal(existsSync(resolve(owned, output)), false);
const profiles = [
  { id: 'gnu53', path: '/tmp/safe-bash-gnu-bash-5.3.Ua5t02/install/bin/bash', sha256: '8cecb482de24198c23a736b931cb7e8cee1f94eb0b51abd54bd99f1d73d9673c' },
  { id: 'apple32', path: '/bin/bash', sha256: '35536aea9733aa345b61134a98d00232380898e55b2ea2a07c497011f7dfc7a3' },
];
const directory = await realpath(await mkdtemp(resolve(owned, '.native-')));
const records = [];
const before = Object.fromEntries(await Promise.all([...profiles.map(profile => profile.path), '/bin/cat', '/usr/bin/head', '/usr/bin/locale'].map(async path => [path, sha256(await readFile(path))])));
for (const profile of profiles) assert.equal(before[profile.path], profile.sha256);
try {
  const locale = await runChild('/usr/bin/locale', ['-a'], { cwd: directory, env: { PATH: '/usr/bin:/bin', LC_ALL: 'C' }, deadline: 3000 });
  assert.ok(transport(locale)); assert.ok(Buffer.from(locale.stdout, 'base64').toString().includes('en_US.UTF-8'));
  for (const profile of profiles) {
    profile.shPath = resolve(directory, profile.id, 'sh');
    await mkdir(dirname(profile.shPath));
    await symlink(profile.path, profile.shPath);
    const version = await runChild(profile.path, ['--version'], { cwd: directory, argv0: 'bash', env: { PATH: '/usr/bin:/bin', LC_ALL: 'C' }, deadline: 3000 });
    assert.ok(transport(version));
    const roleArgs = ['--noprofile', '--norc', '-c', 'printf "name=%s\\n" "$0"; set -o', 'profile-control'];
    const nestedRoleControl = await runChild(profile.shPath, roleArgs, { cwd: directory, env: { PATH: '/usr/bin:/bin', LANG: 'C', LC_ALL: 'C' }, deadline: 3000 });
    assert.ok(transport(nestedRoleControl));
    assert.match(Buffer.from(nestedRoleControl.stdout, 'base64').toString(), /^posix\s+on$/mu);
    const rows = [];
    for (const [index, specimen] of inputs.rows.entries()) {
      const cwd = resolve(directory, `case-${index}`);
      await mkdir(cwd);
      const launch = rendering(specimen, profile, cwd);
      for (const fixture of launch.files) {
        const path = resolve(cwd, fixture.path);
        await mkdir(dirname(path), { recursive: true });
        if (fixture.directory) { await mkdir(path, { recursive: true }); if (fixture.mode !== 0o644) await chmod(path, fixture.mode); }
        else if (fixture.link) await symlink(fixture.link, path);
        else { await writeFile(path, fixture.hex === undefined ? Buffer.from(fixture.text ?? '') : Buffer.from(fixture.hex, 'hex')); await chmod(path, fixture.mode); }
      }
      const initial = await snapshot(cwd);
      const args = ['--noprofile', '--norc', ...launch.args];
      const result = await runChild(profile.path, args, { cwd, argv0: launch.role, env: launch.env, stdin: Buffer.from(launch.stdinHex, 'hex'), deadline: 5000 });
      assert.ok(transport(result), specimen.id);
      rows.push({ id: specimen.id, sourceSha256: sha256(specimen.source), executable: profile.path, argv0: launch.role, args, launch, initial, result, effects: await snapshot(cwd) });
      await rm(cwd, { recursive: true });
    }
    records.push({ ...profile, version, localeControl: locale, nestedRoleControl: { executable: profile.shPath, args: roleArgs, result: nestedRoleControl }, rows });
  }
} finally { await rm(directory, { recursive: true, force: true }); }
const after = Object.fromEntries(await Promise.all(Object.keys(before).map(async path => [path, sha256(await readFile(path))])));
assert.deepEqual(after, before);
save(output, { capturedAt: new Date().toISOString(), inputsSha256: sha256(await readFile(resolve(owned, 'inputs.json'))), before, after, profiles: records, rowsPerProfile: 169, total: 338, directoryRemoved: true, profileCaveat: 'Existing closure cases retain declared UTF-8 overrides and original role-specific executable rendering. Native fixture shebangs are profile binary paths; virtual fixtures retain /bin/bash. Full raw fixture bytes and modes are retained, not normalized.' });
console.log(JSON.stringify({ native: 338, wholeProfiles: 2, rowsEach: 169, cleanup: true }));
