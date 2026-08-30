import { createHash } from 'node:crypto';
import { existsSync, readFileSync, realpathSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { commands } from './fixtures.mjs';
const base = fileURLToPath(new URL('.', import.meta.url));
const env = { LANG: 'C', LC_ALL: 'C', PATH: '/usr/bin:/bin' };
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const candidates = (name) => [...new Set((process.env.PATH ?? '').split(':').map(directory => resolve(directory, name)).concat(name === 'ggrep' ? ['/opt/homebrew/opt/grep/bin/ggrep', '/opt/homebrew/bin/ggrep', '/usr/local/bin/ggrep'] : []))];
const discover = name => candidates(name).find(path => existsSync(path));
const profiles = [{ name: 'rg-primary', tool: 'rg', path: discover('rg'), prefix: ['--no-config', '--color=never', '--no-heading', '--no-line-number', '--no-filename', '--engine=default'] }, { name: 'bsd-grep-auxiliary', tool: 'grep', path: '/usr/bin/grep', prefix: [] }, { name: 'gnu-grep-primary', tool: 'grep', path: discover('ggrep'), prefix: [] }];
for (const profile of profiles) {
  if (!profile.path) { profile.available = false; profile.searched = candidates('ggrep'); continue; }
  profile.available = true;
  profile.realpath = realpathSync(profile.path);
  profile.sha256 = sha256(readFileSync(profile.realpath));
  const version = spawnSync(profile.path, ['--version'], { env, timeout: 2000, maxBuffer: 65536 });
  profile.version = Buffer.concat([version.stdout, version.stderr]).toString();
  profile.versionStatus = version.status;
  const help = spawnSync(profile.path, ['--help'], { env, timeout: 2000, maxBuffer: 262144 });
  profile.helpSha256 = sha256(Buffer.concat([help.stdout, help.stderr]));
}
const results = [];
for (const vector of commands) for (const profile of profiles.filter(entry => entry.available && entry.tool === vector.tool)) {
  const args = [...profile.prefix, ...vector.args, '-'];
  const result = spawnSync(profile.path, args, { env, input: Buffer.from(vector.inputHex, 'hex'), timeout: 2000, maxBuffer: 65536, killSignal: 'SIGKILL' });
  const actual = { status: result.status, signal: result.signal, stdoutHex: result.stdout.toString('hex'), stderrHex: result.stderr.toString('hex'), error: result.error?.message ?? null };
  results.push({ id: vector.id, profile: profile.name, command: [profile.path, ...args], inputHex: vector.inputHex, expected: vector.native, actual, matchesFrozenExpectation: actual.status === vector.native.status && actual.stdoutHex === vector.native.stdoutHex && !actual.error });
}
mkdirSync(resolve(base, 'evidence'), { recursive: true });
writeFileSync(resolve(base, 'evidence/native.json'), JSON.stringify({ at: new Date().toISOString(), platform: process.platform, arch: process.arch, env, profiles, commands: results.length, results, installs: 0, riskyExecutions: 0 }, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ commands: results.length, expectationMismatches: results.filter(result => !result.matchesFrozenExpectation).map(result => result.id), unavailable: profiles.filter(profile => !profile.available).map(profile => profile.name) }));
