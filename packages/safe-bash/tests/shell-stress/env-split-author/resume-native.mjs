import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdtemp, mkdir, symlink, readdir, rm } from 'node:fs/promises';
import { release } from 'node:os';
import { fileURLToPath } from 'node:url';
import { environment } from './cases.mjs';

const directory = fileURLToPath(new URL('.', import.meta.url));
const cases = JSON.parse(await readFile(`${directory}/resume-cases.json`, 'utf8'));
const prior = JSON.parse(await readFile(`${directory}/native-frozen.json`, 'utf8'));
const envProfile = prior.envProfiles.find(profile => profile.name === 'GNU9.7-Darwin');
const profiles = prior.bashProfiles;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const output = process.argv[2];
assert.ok(output?.startsWith('/tmp/'));
const groups = [];
async function run(binary, args, cwd, env, argv0) {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { argv0, cwd, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    groups.push(child.pid);
    const chunks = { stdout: [], stderr: [] };
    let bytes = 0;
    let failure;
    const kill = () => { if (child.pid) try { process.kill(-child.pid, 'SIGKILL'); } catch {} };
    const timer = setTimeout(() => { failure = new Error('native deadline'); kill(); }, 3000);
    for (const channel of ['stdout', 'stderr']) child[channel].on('data', chunk => {
      chunks[channel].push(chunk); bytes += chunk.length;
      if (bytes > 262144) { failure = new Error('native output cap'); kill(); }
    });
    child.on('error', error => { failure = error; });
    child.on('close', (status, signal) => {
      clearTimeout(timer); kill();
      if (failure || signal || status === null) reject(failure ?? new Error(`native signal ${signal}`));
      else resolve({ status, stdoutHex: Buffer.concat(chunks.stdout).toString('hex'), stderrHex: Buffer.concat(chunks.stderr).toString('hex') });
    });
  });
}

const scratch = await mkdtemp('/tmp/safe-bash-env-split-resume-native-');
const report = { date: new Date().toISOString(), platform: process.platform, release: release(), arch: process.arch, fixtureHash: hash(await readFile(`${directory}/resume-cases.json`)), recorderSourceHash: hash(await readFile(`${directory}/recorder.c`)), envProfile, profiles: [], rows: [], groups, scratchRemoved: false };
try {
  assert.equal(hash(await readFile(envProfile.binary)), envProfile.sha256);
  report.envVersion = await run(envProfile.binary, ['--version'], scratch, { LC_ALL: 'C' }, 'env');
  const compiled = await run('/usr/bin/cc', [`${directory}/recorder.c`, '-o', `${scratch}/rec`], scratch, { PATH: '/usr/bin:/bin', LC_ALL: 'C' }, 'cc');
  assert.equal(compiled.status, 0, Buffer.from(compiled.stderrHex, 'hex').toString());
  report.compiler = await run('/usr/bin/cc', ['--version'], scratch, { LC_ALL: 'C' }, 'cc');
  report.recorderHash = hash(await readFile(`${scratch}/rec`));
  for (const profile of profiles) {
    assert.equal(hash(await readFile(profile.binary)), profile.sha256);
    report.profiles.push({ name: profile.name, binary: profile.binary, sha256: profile.sha256, version: await run(profile.binary, ['--version'], scratch, { LC_ALL: 'C' }, 'bash') });
    for (const scenario of cases) {
      const cwd = await mkdtemp(`${scratch}/case-`);
      await symlink(`${scratch}/rec`, `${cwd}/rec`);
      for (const name of scenario.directories ?? []) await mkdir(`${cwd}/${name}`);
      const env = { PATH: cwd, LC_ALL: 'C', LANG: 'C', TZ: 'UTC', ...environment, ...scenario.extraEnv };
      const argv = ['--noprofile', '--norc', '-c', 'exec "$@"', 'shell', envProfile.binary, ...scenario.args];
      const observed = await run(profile.binary, argv, cwd, env, 'bash');
      const entries = (await readdir(cwd)).sort();
      assert.deepEqual(entries, ['rec', ...scenario.directories ?? []].sort());
      report.rows.push({ profile: profile.name, name: scenario.name, argv, env, cwd, observed, entries });
    }
  }
} finally {
  await rm(scratch, { recursive: true, force: true }); report.scratchRemoved = true;
}
for (const pid of groups) if (pid) for (const target of [pid, -pid]) assert.throws(() => process.kill(target, 0), error => error.code === 'ESRCH');
await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' });
console.log(JSON.stringify({ rows: report.rows.length, groupsStopped: groups.length, scratchRemoved: report.scratchRemoved }));
