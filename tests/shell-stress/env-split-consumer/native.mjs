import assert from 'node:assert/strict';
import { mkdtemp, realpath, mkdir, writeFile, chmod, symlink, readFile, readdir, lstat, rm, access } from 'node:fs/promises';
import { release } from 'node:os';
import { resolve } from 'node:path';
import { nativeCases, baseEnv, recordSource, protocol } from './cases.mjs';
import { owned, envTool, profiles, sha256, run, save } from './support.mjs';

const report = { at: new Date().toISOString(), platform: process.platform, release: release(), casesHash: sha256(await readFile(resolve(owned, 'cases.mjs'))), protocol, envTool: { path: envTool, hash: sha256(await readFile(envTool)) }, profiles: [], temporaryDirectories: [], productExecutions: 0 };
assert.equal(report.envTool.hash, '1026eb36ffd2fdca6d064c0ffd6dd99ceb7bb3f49ec5e804df2c53bef372dbf0');
const cleanEnv = { HOME: '/nonexistent', PATH: '/nonexistent', LC_ALL: 'C', LANG: 'C', TZ: 'UTC' };
report.envTool.version = await run(envTool, ['--version'], { env: cleanEnv, cwd: '/tmp', argv0: 'env' });
const effects = async directory => {
  const result = {};
  for (const name of (await readdir(directory)).sort()) {
    if (['bin', 'record', 'script'].includes(name)) continue;
    const path = resolve(directory, name); const stat = await lstat(path);
    result[name] = stat.isFile() ? { hex: (await readFile(path)).toString('hex'), mode: stat.mode & 0o777 } : { type: stat.isDirectory() ? 'directory' : 'other' };
  }
  return result;
};
try {
  for (const profile of profiles) {
    assert.equal(sha256(await readFile(profile.binary)), profile.hash);
    const captured = { ...profile, version: await run(profile.binary, ['--version'], { cwd: '/tmp', env: cleanEnv, argv0: 'bash' }), rows: [], controls: [] };
    report.profiles.push(captured);
    for (const fixture of nativeCases) {
      const directory = await realpath(await mkdtemp('/tmp/safe-bash-packed-env-native-'));
      report.temporaryDirectories.push(directory);
      try {
        await mkdir(resolve(directory, 'bin'));
        await symlink(profile.binary, resolve(directory, 'bin/bash'));
        await symlink(profile.binary, resolve(directory, 'bin/sh'));
        const recorder = `#!${profile.binary}\n${recordSource}`;
        await writeFile(resolve(directory, 'record'), recorder, { mode: 0o755 });
        await symlink('../record', resolve(directory, 'bin/record'));
        await writeFile(resolve(directory, 'phase'), 'seed'); await chmod(resolve(directory, 'phase'), 0o644);
        const env = { ...baseEnv, PATH: resolve(directory, 'bin') };
        const script = fixture.header ? `#!${envTool} ${fixture.header}\n${fixture.body}` : null;
        if (script) await writeFile(resolve(directory, 'script'), script, { mode: 0o755 });
        const executable = script ? profile.binary : envTool;
        const args = script ? ['--noprofile', '--norc', '-c', fixture.source, fixture.shellArg0] : fixture.args;
        const argv0 = script ? 'bash' : 'env';
        const result = await run(executable, args, { cwd: directory, env, argv0 });
        captured.rows.push({ id: fixture.id, executable, args, argv0, shellArg0: script ? fixture.shellArg0 : 'native record script pathname', cwd: directory, env, fixtures: { recorder, script, phase: { hex: '73656564', mode: 0o644 } }, run: result, tuple: { status: result.status, stdoutHex: result.stdoutHex, stderrHex: result.stderrHex, effects: await effects(directory) } });
        if (script) {
          await writeFile(resolve(directory, 'phase'), 'seed');
          const controlArgs = [fixture.header, './script', ...(fixture.source.includes('"a b"') ? ['a b'] : [])];
          const control = await run(envTool, controlArgs, { cwd: directory, env, argv0: 'env' });
          captured.controls.push({ id: fixture.id, role: 'Explicit one optional kernel argument, not replacement oracle', executable: envTool, args: controlArgs, argv0: 'env', cwd: directory, env, run: control, effects: await effects(directory) });
        }
      } finally { await rm(directory, { recursive: true, force: true }); }
    }
  }
} catch (error) { report.failure = { name: error.name, message: error.message }; process.exitCode = 1; }
finally {
  report.cleaned = await Promise.all(report.temporaryDirectories.map(async path => ({ path, absent: await access(path).then(() => false, error => error.code === 'ENOENT') })));
  report.envTool.afterHash = sha256(await readFile(envTool));
  report.bashAfterHashes = await Promise.all(profiles.map(async profile => ({ role: profile.role, hash: sha256(await readFile(profile.binary)) })));
  save('native-frozen.json', report);
}
console.log(JSON.stringify(report.profiles.map(profile => ({ role: profile.role, rows: profile.rows.length, controls: profile.controls.length, statuses: profile.rows.map(row => [row.id, row.tuple.status]) }))));
