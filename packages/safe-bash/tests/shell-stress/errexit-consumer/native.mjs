import assert from 'node:assert/strict';
import { mkdtemp, realpath, mkdir, writeFile, chmod, symlink, readFile, rm } from 'node:fs/promises';
import { tmpdir, platform, release } from 'node:os';
import { resolve, dirname } from 'node:path';
import { nativeCases, hostCases, policy } from './cases.mjs';
import { runChild, sha256, primary, environment, owned, entries, save } from './support.mjs';
const profiles = [];
for (const [role, binary, expectedHash] of [['primary', primary, '8cecb482de24198c23a736b931cb7e8cee1f94eb0b51abd54bd99f1d73d9673c'], ['historical', '/bin/bash', '35536aea9733aa345b61134a98d00232380898e55b2ea2a07c497011f7dfc7a3']]) {
  const binaryHash = sha256(await readFile(binary));
  assert.equal(binaryHash, expectedHash);
  const rows = [];
  const controls = [];
  const fixtures = [...nativeCases, { id: 'profile-control', role: 'bash', options: [], name: 'public consumer', args: [], files: {}, source: 'printf "parent:%s:%s\\n" "$0" "$BASH_VERSION"; bash -c \'printf "bash-child:%s\\n" "$BASH_VERSION"\'; sh -c \'printf "sh-child:%s\\n" "$BASH_VERSION"; set -o\'' }];
  for (const fixture of fixtures) {
    const cwd = await realpath(await mkdtemp(resolve(tmpdir(), 'safe-bash-errexit-consumer-native-')));
    try {
      await mkdir(resolve(cwd, 'bin'));
      for (const name of ['bash', 'sh']) await symlink(binary, resolve(cwd, 'bin', name));
      await symlink('/bin/cat', resolve(cwd, 'bin/cat'));
      for (const [name, file] of Object.entries(fixture.files)) {
        const path = resolve(cwd, name);
        await mkdir(dirname(path), { recursive: true });
        await writeFile(path, file.text);
        await chmod(path, file.mode);
      }
      const env = { ...environment, PATH: resolve(cwd, 'bin') };
      const argv = ['--noprofile', '--norc', ...fixture.options, '-c', fixture.source, fixture.name, ...fixture.args];
      const run = await runChild(binary, argv, { cwd, env, argv0: fixture.role, deadline: 3000 });
      const row = { id: fixture.id, literalSource: fixture.source, sourceHash: sha256(fixture.source), binary, argv, osArgv0: fixture.role, shellArg0: fixture.name, cwd, env, inputHex: '', fixtures: fixture.files, run, tuple: { status: run.status, stdoutHex: Buffer.from(run.stdout, 'base64').toString('hex'), stderrHex: Buffer.from(run.stderr, 'base64').toString('hex'), entries: await entries(cwd, ['bin']) } };
      (fixture.id === 'profile-control' ? controls : rows).push(row);
    } finally { await rm(cwd, { recursive: true, force: true }); }
  }
  profiles.push({ role, binary, binaryHash, version: await runChild(binary, ['--version'], { env: environment, deadline: 3000 }), rows, controls });
}
save('native-frozen.json', { at: new Date().toISOString(), platform: platform(), release: release(), casesHash: sha256(await readFile(`${owned}/cases.mjs`)), nativeCount: nativeCases.length, hostCount: hostCases.length, policy, catHash: sha256(await readFile('/bin/cat')), profiles });
console.log(JSON.stringify(profiles.map(profile => ({ role: profile.role, rows: profile.rows.length, statuses: profile.rows.map(row => [row.id, row.tuple.status]), bounded: [...profile.rows, ...profile.controls].every(row => !row.run.timedOut && !row.run.overflow && !row.run.groupAlive) }))));
