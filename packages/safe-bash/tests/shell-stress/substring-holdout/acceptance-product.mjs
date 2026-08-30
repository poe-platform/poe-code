import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { readFile } from 'node:fs/promises';
import { nativeCases, hostCases, policy } from './cases.mjs';
import { observeHost } from './host.mjs';

const reference = JSON.parse(await readFile(new URL('./native-frozen.json', import.meta.url), 'utf8'));
const [profileId, id] = process.argv.slice(2);
const forbidden = [];
for (const name of ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork']) childProcess[name] = (...args) => { forbidden.push({ name, args }); throw new Error('Product host process forbidden'); };
syncBuiltinESMExports();
const library = await import('../../../src/index.ts');
let shell, observation, launch;
try {
  if (profileId === 'host') {
    assert.ok(hostCases.some(row => row.id === id));
    observation = await observeHost(library, id);
  } else {
    const profile = reference.profiles.find(row => row.id === profileId);
    const fixture = nativeCases.find(row => row.id === id);
    const native = profile.rows.find(row => row.id === id);
    const fs = new library.MemoryFileSystem();
    await fs.mkdir(native.cwd, { recursive: true });
    for (const [name, text] of Object.entries(fixture.files)) { await fs.writeFile(`${native.cwd}/${name}`, Buffer.from(text)); await fs.chmod(`${native.cwd}/${name}`, 0o644); }
    shell = new library.Shell({ fs, cwd: native.cwd, env: native.env }).use(library.agentCommands());
    const argv = ['-c', fixture.script, policy.shellName, ...fixture.args];
    const quote = text => `'${text.replaceAll("'", "'\\''")}'`;
    const wrapper = ['bash', ...argv].map(quote).join(' ');
    const invocations = [];
    shell.use((context, next) => { if (context.command === 'bash') invocations.push([...context.args]); return next(); });
    const result = await shell.exec(wrapper, { stdin: Buffer.from(fixture.stdin, 'base64') });
    assert.deepEqual(invocations, [argv], 'Actual uniform -c source/name/positional argv identity');
    const entries = {};
    async function visit(directory, prefix = '') {
      for (const entry of (await fs.readdir(directory)).sort((left, right) => left.name.localeCompare(right.name))) {
        const path = `${directory}/${entry.name}`, key = prefix + entry.name, stat = await fs.lstat(path);
        if (stat.type === 'directory') { entries[key + '/'] = { type: 'directory', mode: stat.mode & 0o777 }; await visit(path, key + '/'); }
        else if (stat.type === 'symlink') entries[key] = { link: await fs.readlink(path), mode: stat.mode & 0o777 };
        else entries[key] = { bytes: Buffer.from(await fs.readFile(path)).toString('base64'), mode: stat.mode & 0o777 };
      }
    }
    await visit(native.cwd);
    observation = { stdout: Buffer.from(result.stdoutBytes).toString('base64'), stderr: Buffer.from(result.stderrBytes).toString('base64'), status: result.exitCode, entries };
    launch = { command: 'bash', argv, wrapper, actualInvocations: invocations, cwd: native.cwd, env: native.env, stdin: fixture.stdin,
      startupFlags: 'Native --noprofile/--norc disable host startup files. Virtual runtime has no host startup-file loading; these unsupported flags are not passed. Uniform -c SOURCE shell and exact SOURCE/args are preserved for all96 rows.' };
  }
} catch (error) { observation = { failed: true, name: error.name, message: error.message, stack: error.stack, actual: error.actual, expected: error.expected }; }
finally { await shell?.dispose(); }
console.log(JSON.stringify({ observation, launch, forbidden }));
