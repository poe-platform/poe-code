import assert from 'node:assert/strict';
import { readFile, mkdtemp, mkdir, writeFile, symlink, rm } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { nativeCases, hostCases } from './cases.mjs';
import { owned, environment, primary, runChild, snapshot, sha256, sourceGuard, patchJson } from './support.mjs';

const profiles = [{ role: 'PRIMARY', executable: primary }, { role: 'HISTORICAL', executable: '/bin/bash' }];
const report = { generatedAt: new Date().toISOString(), fixturesSha256: sha256(await readFile(resolve(owned, 'cases.mjs'))), nativeRows: nativeCases.length, hostRows: hostCases.length, profiles: [] };
for (const profile of profiles) {
  const version = await runChild(profile.executable, ['--version'], { argv0: 'bash' });
  assert.equal(version.status, 0);
  const results = [];
  for (const fixture of nativeCases) {
    const before = await sourceGuard();
    const temporary = await mkdtemp(resolve(owned, '.native-'));
    try {
      for (const name of ['work', 'search', 'bin']) await mkdir(resolve(temporary, name));
      for (const name of ['bash', 'sh']) await symlink(profile.executable, resolve(temporary, 'bin', name));
      await symlink('/bin/cat', resolve(temporary, 'bin/cat'));
      for (const [name, content] of Object.entries(fixture.files ?? {})) {
        await mkdir(dirname(resolve(temporary, name)), { recursive: true });
        await writeFile(resolve(temporary, name), content);
      }
      const env = { ...environment, PATH: `${temporary}/bin`, HOME: temporary };
      const argv = ['--noprofile', '--norc', '-c', fixture.script, 'shell'];
      const processResult = await runChild(profile.executable, argv, { cwd: temporary, env, argv0: 'bash', stdin: fixture.stdin ?? '' });
      assert.equal(processResult.timedOut || processResult.overflow || processResult.groupAlive, false, fixture.id);
      assert.equal(processResult.signal, null, fixture.id);
      const after = await sourceGuard();
      const normalize = encoded => Buffer.from(Buffer.from(encoded, 'base64').toString('utf8').split(temporary).join('/fixture')).toString('base64');
      results.push({ id: fixture.id, temporary, argv0: 'bash', argv, env, raw: processResult, comparable: { status: processResult.status, stdout: normalize(processResult.stdout), stderr: normalize(processResult.stderr), files: await snapshot(temporary) }, sourceGuard: { before, after, stable: before.sha256 === after.sha256 } });
      process.stderr.write(`${profile.role} ${fixture.id}: ${processResult.status}\n`);
    } finally { await rm(temporary, { recursive: true, force: true }); }
  }
  report.profiles.push({ ...profile, executableSha256: sha256(await readFile(profile.executable)), cat: { executable: '/bin/cat', sha256: sha256(await readFile('/bin/cat')) }, version, results });
}
patchJson('native-frozen.json', report);
