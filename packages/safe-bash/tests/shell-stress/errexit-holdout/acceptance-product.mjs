import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { readFile } from 'node:fs/promises';
import { cases, hostCases, initialFiles, invocation } from './cases.mjs';
import { observeHost } from './host.mjs';

const [role, id] = process.argv.slice(2);
const native = JSON.parse(await readFile(new URL('./native-frozen.json', import.meta.url), 'utf8'));
const forbidden = [];
for (const name of ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork']) childProcess[name] = (...args) => { forbidden.push({ name, args }); throw new Error('Product host process forbidden'); };
syncBuiltinESMExports();
const library = await import('../../../src/index.ts');
let shell, observation, launch, fs, cwd;
async function effects(directory) {
  const entries = {};
  async function visit(current, prefix = '') {
    for (const entry of (await fs.readdir(current)).sort((left, right) => left.name.localeCompare(right.name))) {
      const path = `${current}/${entry.name}`, key = prefix + entry.name, stat = await fs.lstat(path);
      const mode = stat.mode & 0o7777;
      if (stat.type === 'directory') { entries[key] = { kind: 'directory', mode }; await visit(path, `${key}/`); }
      else if (stat.type === 'symlink') entries[key] = { kind: 'symlink', mode, target: await fs.readlink(path) };
      else entries[key] = { kind: 'file', mode, bytes: Buffer.from(await fs.readFile(path)).toString('base64') };
    }
  }
  await visit(directory);
  return entries;
}
try {
  if (role === 'host') {
    assert.ok(hostCases.some(specimen => specimen.id === id));
    observation = await observeHost(library, id);
  } else {
    assert.ok(['bash', 'sh'].includes(role));
    const specimen = cases.find(candidate => candidate.id === id);
    assert.ok(specimen);
    const profile = native.profiles.find(candidate => candidate.id === `gnu53-${role}-C`);
    const reference = profile.rows.find(candidate => candidate.id === id);
    const nativeLaunch = invocation(specimen, role);
    const args = nativeLaunch.args.slice(2);
    assert.deepEqual(nativeLaunch.args.slice(0, 2), ['--noprofile', '--norc']);
    cwd = reference.cwd;
    fs = new library.MemoryFileSystem();
    await fs.mkdir(cwd, { recursive: true });
    for (const [name, fixture] of Object.entries(initialFiles(specimen))) { await fs.writeFile(`${cwd}/${name}`, Buffer.from(fixture.text)); await fs.chmod(`${cwd}/${name}`, fixture.mode); }
    const initial = await effects(cwd);
    assert.deepEqual(initial, reference.initial);
    shell = new library.Shell({ fs, cwd, env: reference.env }).use(library.agentCommands());
    const actualInvocations = [];
    shell.use((context, next) => { if (context.command === 'bash' || context.command === 'sh') actualInvocations.push({ command: context.command, args: [...context.args] }); return next(); });
    const quote = text => `'${text.replaceAll("'", "'\\''")}'`;
    const wrapper = [role, ...args].map(quote).join(' ');
    launch = { command: role, args, wrapper, nativeLaunch, cwd, env: reference.env, stdin: nativeLaunch.stdin, initial, actualInvocations, rendering: 'Uniform removal of native --noprofile/--norc startup-suppression flags: the virtual public API has no host startup loading. Source, semantic flags, command name, positionals and stdin are unchanged. Native role symlinks are oracle infrastructure; real virtual registry commands implement bash/sh/cat. Primary cwd/PATH are used once per role; historical captures have their own recorded temporary roots.' };
    const result = await shell.exec(wrapper, { stdin: Buffer.from(nativeLaunch.stdin) });
    assert.deepEqual(actualInvocations[0], { command: role, args });
    observation = { stdout: Buffer.from(result.stdoutBytes).toString('base64'), stderr: Buffer.from(result.stderrBytes).toString('base64'), status: result.exitCode, effects: await effects(cwd) };
  }
} catch (error) {
  observation = { error: { name: error.name, message: error.message, limit: error.limit ?? null, stack: error.stack }, ...(fs && cwd ? { effects: await effects(cwd) } : {}) };
} finally { await shell?.dispose(); }
console.log(JSON.stringify({ observation, launch, forbidden }));
