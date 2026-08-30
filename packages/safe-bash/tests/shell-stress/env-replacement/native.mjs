import assert from 'node:assert/strict';
import { readFile, mkdtemp, mkdir, symlink, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { nativeCases, hostCases } from './cases.mjs';
import { owned, primary, env, runChild, save, sha256, effects, snapshot } from './harness.mjs';
const report = { timestamp: new Date().toISOString(), casesHash: sha256(await readFile(resolve(owned, 'cases.mjs'))), nativeRows: nativeCases.length, hostRows: hostCases.length, envTool: { path: '/usr/bin/env', sha256: sha256(await readFile('/usr/bin/env')), role: 'Apple system env in BOTH Bash profiles, not GNU coreutils env; outer PATH=/usr/bin:/bin. Bare env after -i uses system default search, not a profile symlink.' }, profiles: [], before: await snapshot() };
for (const [role, binary] of [['PRIMARY', primary], ['HISTORICAL', '/bin/bash']]) {
  const version = await runChild(binary, ['--version'], { env });
  const rows = [];
  for (const fixture of nativeCases) {
    const directory = await mkdtemp(resolve(owned, '.native-'));
    try {
      await mkdir(resolve(directory, 'work')); await mkdir(resolve(directory, 'bin'));
      await symlink(binary, resolve(directory, 'bin/sh'));
      const script = fixture.script.replaceAll('{{BASH}}', `'${binary}'`).replaceAll('{{SH}}', `'${directory}/bin/sh'`);
      const args = ['--noprofile', '--norc', '-c', script, 'shell'];
      const run = await runChild(binary, args, { cwd: directory, env, argv0: 'bash' });
      assert.equal(run.timedOut || run.overflow || run.groupAlive, false);
      rows.push({ id: fixture.id, directory, argv0: 'bash', args, env, run, tuple: { stdout: run.stdout, stderr: run.stderr, status: run.status, files: await effects(directory) } });
    } finally { await rm(directory, { recursive: true, force: true }); }
  }
  report.profiles.push({ role, binary, sha256: sha256(await readFile(binary)), version, rows });
}
report.defaultSearchControl = await runChild('/usr/bin/env', ['-i', '/usr/bin/which', 'env'], { env });
report.after = await snapshot();
save('native-frozen.json', report);
console.log(JSON.stringify(report.profiles.map(profile => ({ role: profile.role, rows: profile.rows.length, original: profile.rows[0].tuple, nonzero: profile.rows.filter(row => row.tuple.status !== 0).map(row => row.id) }))));
