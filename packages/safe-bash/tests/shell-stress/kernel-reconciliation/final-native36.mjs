import { mkdtemp, mkdir, writeFile, chmod, symlink, lstat, readdir, readFile, readlink, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, dirname, relative } from 'node:path';
import { nativeCases, hostCases, policy } from '../expanded-gaps/cases.mjs';
import { runChild, sha256, primary, env, owned } from '../expanded-gaps/harness.mjs';
import { save } from './support.mjs';
const profiles = [];
for (const [role, binary] of [['primary', primary], ['historical', '/bin/bash']]) {
  const rows = []; const controls = [];
  for (const fixture of [...nativeCases, { id: 'profile-control', script: 'printf "parent:%s:%s\\n" "$0" "$BASH_VERSION"; ./env-control; ./direct-control', files: { 'env-control': { text: '#!/usr/bin/env bash\nprintf "env-child:%s:%s\\n" "$BASH" "$BASH_VERSION"\n', mode: 0o755 }, 'direct-control': { text: '#!/bin/bash\nprintf "direct-child:%s:%s\\n" "$BASH" "$BASH_VERSION"\n', mode: 0o755 } } }]) {
    const directory = await realpath(await mkdtemp(resolve(tmpdir(), 'safe-bash-gaps-native-')));
    try {
      for (const name of ['work', 'bin', '.roles']) await mkdir(resolve(directory, name));
      for (const name of ['bash', 'sh']) await symlink(binary, resolve(directory, '.roles', name));
      for (const name of ['cat', 'env']) await symlink(`/usr/bin/${name === 'cat' ? '../bin/cat' : name}`, resolve(directory, '.roles', name));
      for (const [name, entry] of Object.entries(fixture.files ?? {})) { const path = resolve(directory, name); await mkdir(dirname(path), { recursive: true }); await writeFile(path, entry.text); await chmod(path, entry.mode); }
      for (const [name, target] of Object.entries(fixture.links ?? {})) await symlink(target, resolve(directory, name));
      const nativeEnv = Object.fromEntries(Object.entries(env).map(([key, value]) => [key, value.replaceAll('/fixture', directory)]));
      const args = ['--noprofile', '--norc', '-c', fixture.script, 'shell'];
      const run = await runChild(binary, args, { cwd: directory, env: nativeEnv, argv0: 'bash' });
      const entries = {};
      async function visit(path) { for (const name of (await readdir(path)).sort()) { if (name === '.roles') continue; const child = resolve(path, name); const key = relative(directory, child); const stat = await lstat(child); if (stat.isDirectory()) { entries[key + '/'] = null; await visit(child); } else if (stat.isSymbolicLink()) entries[key] = { link: await readlink(child) }; else { await chmod(child, stat.mode | 0o400); entries[key] = { bytes: (await readFile(child)).toString('base64'), mode: stat.mode & 0o777 }; } } }
      await visit(directory);
      const project = value => Buffer.from(Buffer.from(value, 'base64').toString().replaceAll(directory, '/fixture')).toString('base64');
      const row = { id: fixture.id, args, argv0: 'bash', cwd: directory, env: nativeEnv, run, tuple: { stdout: project(run.stdout), stderr: project(run.stderr), status: run.status, entries } };
      (fixture.id === 'profile-control' ? controls : rows).push(row);
    } finally { await rm(directory, { recursive: true, force: true }); }
  }
  profiles.push({ role, binary, hash: sha256(await readFile(binary)), version: await runChild(binary, ['--version']), rows, controls });
}
save('final-native36-6e3e316.json', { captured: new Date().toISOString(), policy, casesHash: sha256(await readFile(resolve(owned, 'cases.mjs'))), nativeCount: nativeCases.length, hostCount: hostCases.length, tools: { env: { path: '/usr/bin/env', hash: sha256(await readFile('/usr/bin/env')) }, directBash: { path: '/bin/bash', hash: sha256(await readFile('/bin/bash')) } }, profiles });
console.log(JSON.stringify(profiles.map(profile => ({ role: profile.role, rows: profile.rows.length, stopped: profile.rows.every(row => !row.run.groupAlive && !row.run.timedOut), controls: profile.controls.map(row => Buffer.from(row.run.stdout, 'base64').toString()) }))));
