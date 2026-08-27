import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { Shell, agentCommands, createMemoryFileSystem, writeText } from '../../../src/index.ts';
import { cases, environment, protocols } from './cases.mjs';

const quote = value => `'${value.replaceAll("'", "'\\''")}'`;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const sourcePaths = ['src/shell/runtime.ts', 'src/shell/parser.ts', 'src/commands/execution.ts', 'src/commands/internal.ts', 'src/contracts/command.ts'];
const snapshot = async () => Object.fromEntries(await Promise.all(sourcePaths.map(async path => [path, hash(await readFile(path))])));
const before = await snapshot();
assert.match(import.meta.resolve('../../../src/shell/runtime.js'), /runtime\.ts$/u);
const result = { stage: 'current unchanged product BEFORE env-S implementation', before, importedRuntime: import.meta.resolve('../../../src/shell/runtime.js'), fixtureHash: hash(await readFile(new URL('./cases.mjs', import.meta.url))), core: [], protocol: [] };
for (const [name, args] of cases) {
  const fs = createMemoryFileSystem(); const calls = [];
  const shell = new Shell({ fs, env: { PATH: '', LC_ALL: 'C', LANG: 'C', TZ: 'UTC', ...environment } }).use(agentCommands());
  shell.use(async (context, next) => { calls.push(context.command); return next(); });
  shell.register({ name: 'rec', async execute(context) {
    const argv = [context.command, ...context.args];
    let text = `argc=${argv.length}\n`;
    for (const [index, value] of argv.entries()) text += `arg${index}=${Buffer.from(value).toString('hex')}\n`;
    for (const key of ['V', 'EMPTY', 'KEEP', 'A', 'B', 'FLAG']) text += `env:${key}=${Object.hasOwn(context.env, key) ? Buffer.from(context.env[key]).toString('hex') : '<unset>'}\n`;
    await writeText(context.stdout, text); return { exitCode: 0 };
  } });
  try {
    const observed = await shell.exec(['env', ...args].map(quote).join(' '));
    result.core.push({ name, observed: { status: observed.exitCode, stdoutHex: Buffer.from(observed.stdoutBytes).toString('hex'), stderrHex: Buffer.from(observed.stderrBytes).toString('hex') }, calls, entries: (await fs.readdir('/')).map(entry => entry.name) });
  } finally { await shell.dispose(); }
}
for (const [name, optional] of protocols) {
  const fs = createMemoryFileSystem(); await fs.mkdir('/sub');
  const source = `#!/usr/bin/env ${optional}\nprintf '[%s][%s]:%s' "$1" "$2" "$KEEP"; false; printf BAD\n`;
  await fs.writeFile('/script', Buffer.from(source), { mode: 0o755 });
  await fs.writeFile('/sub/script', Buffer.from('printf relocated; false; printf BAD\n'));
  const shell = new Shell({ fs, env: { PATH: '', LC_ALL: 'C', LANG: 'C', TZ: 'UTC', ...environment } }).use(agentCommands());
  try {
    const observed = await shell.exec("./script '' 'a b'");
    result.protocol.push({ name, observed: { status: observed.exitCode, stdoutHex: Buffer.from(observed.stdoutBytes).toString('hex'), stderrHex: Buffer.from(observed.stderrBytes).toString('hex') } });
  } finally { await shell.dispose(); }
}
const after = await snapshot(); assert.deepEqual(after, before); result.after = after;
assert.ok(process.argv[2]?.startsWith('/tmp/'));
await writeFile(process.argv[2], `${JSON.stringify(result, null, 2)}\n`, { flag: 'wx' });
console.log(JSON.stringify({ core: result.core.length, protocol: result.protocol.length, stableProduct: true }));
