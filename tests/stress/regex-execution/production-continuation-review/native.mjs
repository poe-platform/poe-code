import { mkdir, mkdtemp, writeFile, readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { globCases, files } from './cohort.mjs';
import { walkerCases } from './walker-cases.mjs';

const owned = resolve('tests/stress/regex-execution/production-continuation-review');
const walker = process.argv[2] === 'walker';
await mkdir(resolve(owned, '.temporary'), { recursive: true });
const cwd = await mkdtemp(resolve(owned, '.temporary/native-'));
for (const [path, contents] of Object.entries(files)) {
  await mkdir(dirname(resolve(cwd, path)), { recursive: true });
  await writeFile(resolve(cwd, path), contents);
}
const executable = spawnSync('/bin/zsh', ['-lc', 'command -v rg'], { encoding: 'utf8', timeout: 2000 }).stdout.trim();
if (!executable) throw new Error('actual primary native rg required');
const env = { PATH: '/usr/bin:/bin', HOME: cwd, LC_ALL: 'C', LANG: 'C' };
const observations = [];
for (const fixture of walker ? walkerCases : globCases) {
  const directory = walker ? await mkdtemp(resolve(owned,'.temporary/native-walker-')) : cwd;
  if (walker) for (const [path,contents] of Object.entries(fixture.files)) await writeFile(resolve(directory,path),contents);
  const args = ['--no-config', '--sort', 'path', '--color', 'never', ...fixture.args];
  const result = spawnSync(executable, args, { cwd:directory, env:{...env,HOME:directory}, timeout: 2000, maxBuffer: 65536 });
  observations.push({ id: fixture.id, args, cwd:directory, code: result.status, signal: result.signal, error: result.error?.message, stdout: result.stdout.toString('base64'), stderr: result.stderr.toString('base64'), declaredPass: result.status === fixture.code && result.stdout.toString() === fixture.output && (fixture.code === 2 ? result.stderr.length > 0 : result.stderr.length === 0), nativeEqualityRequired:fixture.nativeEquality??true });
}
const evidence = { time: new Date().toISOString(), profile: 'primary actual default-engine ripgrep on Darwin arm64, no config, C locale, explicitly path-sorted, isolated fixtures; no shell regex interpolation', executable, executableSha256: createHash('sha256').update(await readFile(executable)).digest('hex'), version: spawnSync(executable, ['--version'], { env, encoding: 'utf8', timeout: 2000 }).stdout, cwd, files, observations, riskConsumed: 0 };
await writeFile(resolve(owned, walker ? 'evidence/native-walker.json' : 'evidence/native-globs.json'), JSON.stringify(evidence, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ passed: observations.filter(item => item.declaredPass).length, total: observations.length, failures: observations.filter(item => !item.declaredPass) }));
