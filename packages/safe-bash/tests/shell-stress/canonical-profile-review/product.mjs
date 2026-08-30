import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { readFile } from 'node:fs/promises';
import { rendering } from './support.mjs';

const [id, context] = process.argv.slice(2);
const inputs = JSON.parse(await readFile(new URL('./inputs.json', import.meta.url)));
const native = JSON.parse(await readFile(new URL('./native-role-corrected.json', import.meta.url)));
const row = inputs.rows.find(candidate => candidate.id === id);
assert.ok(row);
const forbidden = [];
for (const name of ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork']) childProcess[name] = () => { forbidden.push(name); throw new Error('No product host process'); };
syncBuiltinESMExports();
const library = await import('../../../src/index.ts');
const reference = native.profiles[0].rows.find(candidate => candidate.id === id);
const original = context === 'original';
const cwd = original ? '/' : reference.launch.cwd;
const launch = rendering(row, native.profiles[0], cwd, true);
const fs = new library.MemoryFileSystem();
await fs.mkdir(cwd, { recursive: true });
for (const fixture of launch.files) {
  const path = library.resolvePath(cwd, fixture.path);
  await fs.mkdir(library.dirname(path), { recursive: true });
  if (fixture.directory) { await fs.mkdir(path, { recursive: true }); if (fixture.mode !== 0o644) await fs.chmod(path, fixture.mode); }
  else if (fixture.link) await fs.symlink(fixture.link, path);
  else {
    const explicitMode = row.cohort === 'discovery' || row.cohort === 'control' || (row.cohort === 'closure' && !(row.entry === 'file' && fixture.path === 'entry.sh'));
    await fs.writeFile(path, fixture.hex === undefined ? Buffer.from(fixture.text ?? '') : Buffer.from(fixture.hex, 'hex'), explicitMode ? { mode: fixture.mode } : undefined);
  }
}
async function snapshot() {
  const entries = {};
  async function visit(current, prefix = '') {
    for (const entry of (await fs.readdir(current)).sort((left, right) => left.name.localeCompare(right.name))) {
      const path = library.resolvePath(current, entry.name), key = prefix + entry.name, stat = await fs.lstat(path), mode = stat.mode & 0o7777;
      if (stat.type === 'directory') { entries[key] = { type: 'directory', mode }; await visit(path, `${key}/`); }
      else if (stat.type === 'symlink') entries[key] = { type: 'symlink', mode, link: await fs.readlink(path) };
      else entries[key] = { type: 'file', mode, base64: Buffer.from(await fs.readFile(path)).toString('base64') };
    }
  }
  await visit(cwd);
  return entries;
}
const initial = await snapshot();
let guarded = fs;
if (row.cohort === 'discovery') {
  const disallowed = new Set(['readFile', 'readFileStream', 'writeFile', 'writeFileStream', 'appendFile', 'mkdir', 'rm', 'rmdir', 'rename', 'copyFile', 'symlink', 'link', 'chmod', 'utimes']);
  guarded = new Proxy(fs, { get(target, key) { if (disallowed.has(String(key))) return () => { throw new Error(`Discovery forbidden filesystem operation: ${String(key)}`); }; const value = Reflect.get(target, key); return typeof value === 'function' ? value.bind(target) : value; } });
}
const commands = new library.CommandRegistry(row.cohort === 'discovery' ? [] : library.createStandardCommands());
const shell = new library.Shell({ fs: guarded, commands, cwd, env: original ? {} : launch.env });
const registry = { printfRegistered: commands.get('printf') !== undefined, trueRegistered: commands.get('true') !== undefined };
const calls = [];
shell.use((context, next) => { if (context.command === 'bash' || context.command === 'sh') calls.push({ command: context.command, args: [...context.args] }); return next(); });
const quote = text => `'${text.replaceAll("'", "'\\''")}'`;
const source = original ? row.source : [launch.role, ...launch.args].map(quote).join(' ');
const input = Buffer.from(launch.stdinHex, 'hex');
const stdin = row.chunkBytes ? (async function* () { for (let offset = 0; offset < input.length; offset += row.chunkBytes) yield input.subarray(offset, offset + row.chunkBytes); })() : input;
let actual;
try {
  const result = await shell.exec(source, { stdin, ...(original ? { env: row.env ?? {} } : {}), limits: row.limits ?? {} });
  actual = { stdout: Buffer.from(result.stdoutBytes).toString('base64'), stderr: Buffer.from(result.stderrBytes).toString('base64'), status: result.exitCode, effects: await snapshot() };
} catch (error) { actual = { error: { name: error.name, message: error.message, limit: error.limit ?? null }, effects: await snapshot() }; }
finally { await shell.dispose(); }
console.log(JSON.stringify({ id, context, launch: { ...launch, actualSource: source, originalRootEnv: original ? {} : null, calls }, initial, registry, actual, forbidden }));
