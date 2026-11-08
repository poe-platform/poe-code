import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdtemp, mkdir, symlink, rm, readdir, realpath } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import { cases, environment, protocols } from './cases.mjs';

const directory = fileURLToPath(new URL('.', import.meta.url));
const gnu = '/var/folders/rw/s4cy76hn6v55qrp0dhcbtplc0000gn/T/safe-byte-gnu.0SnJMX/coreutils-9.7/src/env';
const envProfiles = [{ name: 'GNU9.7-Darwin', binary: gnu }, { name: 'Apple-env-Darwin', binary: '/usr/bin/env' }];
const bashProfiles = [{ name: 'GNU5.3', binary: '/tmp/safe-bash-gnu-bash-5.3.Ua5t02/install/bin/bash' }, { name: 'Apple3.2', binary: '/bin/bash' }];
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const output = process.argv[2];
assert.ok(output?.startsWith('/tmp/'));
const groups = [];
async function run(binary, args, cwd, env, argv0 = 'env') {
  return await new Promise((resolve, reject) => {
    const child = spawn(binary, args, { argv0, cwd, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    groups.push(child.pid);
    const chunks = { stdout: [], stderr: [] }; let bytes = 0; let failed;
    const kill = () => { if (child.pid) try { process.kill(-child.pid, 'SIGKILL'); } catch {} };
    const timer = setTimeout(() => { failed = new Error('native deadline'); kill(); }, 3000);
    for (const channel of ['stdout', 'stderr']) child[channel].on('data', chunk => { bytes += chunk.length; chunks[channel].push(chunk); if (bytes > 262144) { failed = new Error('native output limit'); kill(); } });
    child.on('error', error => { failed = error; });
    child.on('close', (status, signal) => {
      clearTimeout(timer); kill();
      if (failed || signal || status === null) reject(failed ?? new Error(`native signal ${signal}`));
      else resolve({ status, stdoutHex: Buffer.concat(chunks.stdout).toString('hex'), stderrHex: Buffer.concat(chunks.stderr).toString('hex') });
    });
  });
}
const scratch = await mkdtemp('/tmp/safe-bash-env-split-author-');
const report = { date: new Date().toISOString(), platform: process.platform, release: os.release(), arch: process.arch, fixtureHash: hash(await readFile(`${directory}/cases.mjs`)), recorderSource: await readFile(`${directory}/recorder.c`, 'utf8'), environment, envProfiles: [], bashProfiles: [], core: [], protocol: [], darwinKernel: [], groups, scratchRemoved: false };
try {
  const compile = await run('/usr/bin/cc', [`${directory}/recorder.c`, '-o', `${scratch}/rec`], scratch, { PATH: '/usr/bin:/bin', LC_ALL: 'C' }, 'cc');
  assert.equal(compile.status, 0, Buffer.from(compile.stderrHex, 'hex').toString());
  report.recorderHash = hash(await readFile(`${scratch}/rec`));
  report.compiler = await run('/usr/bin/cc', ['--version'], scratch, { LC_ALL: 'C' }, 'cc');
  for (const profile of envProfiles) report.envProfiles.push({ ...profile, realpath: await realpath(profile.binary), sha256: hash(await readFile(profile.binary)), versionProbe: await run(profile.binary, ['--version'], scratch, { LC_ALL: 'C' }) });
  for (const profile of bashProfiles) report.bashProfiles.push({ ...profile, sha256: hash(await readFile(profile.binary)), versionProbe: await run(profile.binary, ['--version'], scratch, { LC_ALL: 'C' }, 'bash') });
  for (const profile of envProfiles) for (const [name, args] of cases) {
    const cwd = await mkdtemp(`${scratch}/core-`); await symlink(`${scratch}/rec`, `${cwd}/rec`);
    const env = { PATH: cwd, LC_ALL: 'C', LANG: 'C', TZ: 'UTC', ...environment };
    const observed = await run(profile.binary, args, cwd, env);
    report.core.push({ profile: profile.name, name, args, cwd, env, observed, marker: (await readdir(cwd)).includes('marker') ? (await readFile(`${cwd}/marker`)).toString('hex') : null });
  }
  for (const profile of bashProfiles) for (const [name, optional] of protocols) {
    const cwd = await mkdtemp(`${scratch}/protocol-`); await symlink(profile.binary, `${cwd}/bash`); await mkdir(`${cwd}/sub`);
    const source = `#!/usr/bin/env ${optional}\nprintf '[%s][%s]:%s' "$1" "$2" "$KEEP"; false; printf BAD\n`;
    const relocated = 'printf relocated; false; printf BAD\n';
    await writeFile(`${cwd}/script`, source, { mode: 0o755 }); await writeFile(`${cwd}/sub/script`, relocated);
    const env = { PATH: cwd, LC_ALL: 'C', LANG: 'C', TZ: 'UTC', ...environment };
    const args = [optional, './script', '', 'a b'];
    report.protocol.push({ profile: profile.name, envBinary: gnu, name, protocol: 'explicit ONE kernel optional argv, not Darwin kernel execution', optional, source, relocated, args, cwd, env, observed: await run(gnu, args, cwd, env) });
    if (name === 'environment') {
      report.bashProfiles.find(value => value.name === profile.name).emptyEnvironmentRoleControl = await run(gnu, ['-i', `PATH=${cwd}`, 'bash', '--noprofile', '--norc', '-c', 'printf "%s" "$BASH_VERSION"', 'role-control'], cwd, env);
    }
    if (['plain-e', 'quote-argument', 'literal-no-S', 'environment'].includes(name)) {
      const parentArgs = ['--noprofile', '--norc', '-c', './script "" "a b"', 'shell'];
      report.darwinKernel.push({ profile: profile.name, envBinary: '/usr/bin/env', name, protocol: 'actual Darwin kernel through fixed Bash parent', source, args: parentArgs, cwd, env, observed: await run(profile.binary, parentArgs, cwd, env, 'bash') });
    }
  }
} finally { await rm(scratch, { recursive: true, force: true }); report.scratchRemoved = true; }
for (const pid of groups) if (pid) for (const target of [pid, -pid]) assert.throws(() => process.kill(target, 0), error => error.code === 'ESRCH');
await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' });
console.log(JSON.stringify({ coreRows: report.core.length, protocolRows: report.protocol.length, darwinRows: report.darwinKernel.length, allGroupsStopped: groups.length, scratchRemoved: report.scratchRemoved }));
