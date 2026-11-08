import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import assert from 'node:assert/strict';

export async function trapped(loadLibrary, action) {
  const methods = ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork'];
  const saved = Object.fromEntries(methods.map(name => [name, childProcess[name]]));
  const fetch = globalThis.fetch;
  const attempts = [];
  for (const name of methods) childProcess[name] = () => { attempts.push(name); throw new Error(`Product host process forbidden: ${name}`); };
  globalThis.fetch = () => { attempts.push('fetch'); throw new Error('Product network forbidden'); };
  syncBuiltinESMExports();
  try {
    const library = await loadLibrary();
    assert.equal(typeof library.agentCommands, 'function');
    const result = await action(library);
    assert.deepEqual(attempts, []);
    return { result, forbiddenAttempts: attempts };
  } finally {
    Object.assign(childProcess, saved); globalThis.fetch = fetch; syncBuiltinESMExports();
  }
}
const quote = value => `'${value.replaceAll("'", "'\\''")}'`;
export async function runProductRow(loadLibrary, row) {
  assert.ok(['command', 'single-optional'].includes(row.category));
  return trapped(loadLibrary, async library => {
    const fs = new library.MemoryFileSystem();
    await fs.mkdir(row.cwd, { recursive: true });
    for (const [relative, entry] of Object.entries(row.before)) {
      assert.equal(entry.type, 'file');
      await fs.writeFile(`${row.cwd}/${relative}`, Buffer.from(entry.hex, 'hex'), { mode: entry.mode });
    }
    if (row.fixture) {
      await fs.mkdir(library.dirname(row.fixture.path), { recursive: true });
      await fs.writeFile(row.fixture.path, new TextEncoder().encode(row.fixture.virtualSource), { mode: row.fixture.mode });
    }
    const commands = new library.CommandRegistry();
    const invocations = [];
    commands.register({ name: 'argvprobe', async execute(context) {
      const chunks = [];
      for await (const chunk of context.stdin) chunks.push(Buffer.from(chunk));
      const argv = [context.command, ...context.args];
      const record = { argc: argv.length, argvHex: argv.map(arg => Buffer.from(arg).toString('hex')), envHex: Object.entries(context.env).map(([key, value]) => Buffer.from(`${key}=${value}`).toString('hex')), stdinHex: Buffer.concat(chunks).toString('hex'), cwdHex: Buffer.from(context.cwd).toString('hex') };
      invocations.push({ ...record, stdinIsDefault: context.stdinIsDefault });
      await context.stdout.write(Buffer.from(JSON.stringify(record) + '\n'));
      return { exitCode: 0 };
    } });
    const shell = new library.Shell({ fs, commands, cwd: row.cwd, env: row.env });
    shell.use(library.agentCommands());
    const source = row.category === 'command' ? ['env', ...row.args].map(quote).join(' ') : [row.fixture.path, 'argument with spaces', ''].map(quote).join(' ');
    let result;
    try {
      const actual = await shell.exec(source, { stdin: Buffer.from(row.stdinHex, 'hex') });
      result = { status: actual.exitCode, stdout: Buffer.from(actual.stdoutBytes).toString('base64'), stderr: Buffer.from(actual.stderrBytes).toString('base64') };
    } catch (error) { result = { error: { name: error.name, message: error.message, limit: error.limit ?? null } }; }
    const effects = {};
    async function visit(directory, prefix = '') {
      for (const entry of await fs.readdir(directory)) {
        const path = library.resolvePath(directory, entry.name), stat = await fs.lstat(path), key = prefix + entry.name;
        effects[key] = { type: stat.type, mode: stat.mode & 0o7777, ...(stat.type === 'file' ? { hex: Buffer.from(await fs.readFile(path)).toString('hex') } : stat.type === 'symlink' ? { target: await fs.readlink(path) } : {}) };
        if (stat.type === 'directory') await visit(path, `${key}/`);
      }
    }
    await visit(row.cwd); await shell.dispose();
    return { id: row.id, category: row.category, source, incomingEnv: row.env, stdinHex: row.stdinHex, result, effects, invocations, fixtureBinding: row.fixture ? { native: row.fixture.source, virtual: row.fixture.virtualSource } : null };
  });
}
