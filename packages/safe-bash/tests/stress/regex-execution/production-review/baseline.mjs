import { readFile, writeFile } from 'node:fs/promises';
import { execFileSync, spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { cases } from './cohort.mjs';

const owned = resolve('tests/stress/regex-execution/production-review');
const snapshot = resolve(owned, 'snapshots/baseline');
const build = spawnSync(resolve('node_modules/.bin/tsc'), ['-p', resolve(snapshot, 'tsconfig.build.json')], { encoding: 'utf8' });
await writeFile(resolve(owned, 'evidence/baseline-build.json'), JSON.stringify({ status: build.status, stdout: build.stdout, stderr: build.stderr }, null, 2));
if (build.status !== 0) throw new Error('baseline compile failed');
const api = await import(pathToFileURL(resolve(snapshot, 'dist/index.js')));
const quote = value => "'" + value.replaceAll("'", "'\\''") + "'";
const results = [];
for (const fixture of cases) {
  const shell = new api.Shell({ fs: new api.MemoryFileSystem() }).use(api.agentCommands());
  const result = await shell.exec(fixture.script ?? [fixture.command, ...fixture.args].map(quote).join(' '), { stdin: fixture.input ?? '' });
  await shell.dispose();
  results.push({ id: fixture.id, code: result.exitCode, stdout: Buffer.from(result.stdoutBytes).toString('base64'), stderr: Buffer.from(result.stderrBytes).toString('base64'), expectedCode: fixture.code, expectedOutput: fixture.output, expectedPass: result.exitCode === fixture.code && (fixture.output === undefined || result.stdout === fixture.output) });
}
const native = [];
const rg = execFileSync('/bin/zsh', ['-lc', 'command -v rg'], { encoding: 'utf8' }).trim();
const ggrep = spawnSync('/bin/zsh', ['-lc', 'command -v ggrep'], { encoding: 'utf8' });
for (const fixture of cases.filter(item => item.command)) {
  for (const executable of fixture.command === 'rg' ? [rg] : ['/usr/bin/grep', ...(ggrep.status === 0 ? [ggrep.stdout.trim()] : [])]) {
    const result = spawnSync(executable, fixture.command === 'rg' ? ['--no-config', ...fixture.args] : fixture.args, { input: fixture.input, timeout: 2000, maxBuffer: 65536, env: { PATH: '/usr/bin:/bin', LC_ALL: 'C', LANG: 'C', HOME: owned } });
    native.push({ id: fixture.id, executable, profile: fixture.command === 'rg' ? 'primary default-engine rg' : executable === '/usr/bin/grep' ? 'primary Darwin BSD grep' : 'auxiliary GNU grep on Darwin', code: result.status, signal: result.signal, error: result.error?.message, stdout: result.stdout?.toString('base64'), stderr: result.stderr?.toString('base64') });
  }
}
await writeFile(resolve(owned, 'evidence/baseline-commands.json'), JSON.stringify({ results, native, versions: { rg: spawnSync(rg, ['--version'], { encoding: 'utf8' }).stdout, bsdGrep: spawnSync('/usr/bin/grep', ['--version'], { encoding: 'utf8' }).stdout, gnuAvailable: ggrep.status === 0 }, riskConsumed: 0 }, null, 2) + '\n');
console.log(JSON.stringify({ cases: results.length, expectationFailures: results.filter(item => !item.expectedPass), native: native.length }));
