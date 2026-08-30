import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { registerHooks, syncBuiltinESMExports } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';

const request = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const loads = [];
const attempts = [];
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const hook = registerHooks({ load(url, context, nextLoad) {
  const result = nextLoad(url, context);
  if (url.startsWith('file:')) {
    const path = fileURLToPath(url);
    assert.ok(path.startsWith(`${request.dist}/`), `foreign product import: ${path}`);
    const actual = hash(result.source ?? readFileSync(path));
    assert.equal(actual, request.distHashes[path.slice(request.dist.length + 1)]);
    loads.push({ path: path.slice(request.dist.length + 1), sha256: actual });
  }
  return result;
} });
for (const name of ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork']) {
  childProcess[name] = () => { attempts.push(name); throw new Error(`product native execution denied: ${name}`); };
}
globalThis.fetch = () => { attempts.push('fetch'); throw new Error('product network denied'); };
syncBuiltinESMExports();
const library = await import(pathToFileURL(`${request.dist}/index.js`).href);
const encoder = new TextEncoder();
const fs = new library.MemoryFileSystem();
const row = request.row;
const root = request.root;
await fs.mkdir(`${root}/sub`, { recursive: true, mode: 0o755 });
const files = row.files ?? { script: { text: '#!/usr/bin/env -S bash\nreviewhold\n', mode: 0o755 }, effect: { text: 'seed', mode: 0o644 } };
for (const [path, file] of Object.entries(files)) await fs.writeFile(`${root}/${path}`, encoder.encode(file.text), { mode: file.mode });
const shell = new library.Shell({ fs, cwd: root, env: request.env });
shell.use(library.agentCommands());
const observations = [];
shell.use((context, next) => { observations.push({ command: context.command, args: [...context.args], cwd: context.cwd, env: { ...context.env }, stdinIsDefault: context.stdinIsDefault }); return next(); });
const controller = new AbortController();
const deadline = setTimeout(() => controller.abort(new Error('review deadline')), 4000);
const errorRecord = error => ({ name: error?.name, message: error?.message ?? String(error), limit: error?.limit });
const quote = text => `'${text.replaceAll("'", "'\\''")}'`;
const resultRecord = result => ({ status: result.exitCode, stdout: Buffer.from(result.stdoutBytes).toString('base64'), stderr: Buffer.from(result.stderrBytes).toString('base64') });
const data = { id: row.id, observations, attempts, loads, result: null, error: null, hostPassed: false, checks: {} };
const execute = async (source, options = {}) => {
  try { const result = await shell.exec(source, { signal: controller.signal, ...options }); data.result = resultRecord(result); return result; }
  catch (error) { data.error = errorRecord(error); throw error; }
};
const putScript = async (name, body) => fs.writeFile(`${root}/${name}`, encoder.encode(`#!/usr/bin/env -S bash\n${body}\n`), { mode: 0o755 });
const expectLimit = async (source, limits, name) => {
  try { await execute(source, { limits }); }
  catch (error) { assert.ok(error instanceof library.ShellLimitError); assert.equal(error.limit, name); data.checks.limit = name; return; }
  assert.fail(`expected ${name} rejection`);
};
try {
  if (row.kind) {
    if (row.kind === 'direct-env') {
      shell.register({ name: 'reviewbridge', execute: context => context.invoke('env', row.argv) });
      await execute('reviewbridge');
    } else {
      await execute(`${row.prelude ?? ''}${[row.scriptPath, ...row.args].map(quote).join(' ')}`, row.stdin === undefined ? {} : { stdin: encoder.encode(row.stdin) });
    }
  } else if (row.id === 'h01') {
    await putScript('script', './inner');
    await putScript('inner', 'printf reached > effect');
    await expectLimit('./script', { maxCommands: 2 }, 'maxCommands');
    assert.equal(new TextDecoder().decode(await fs.readFile(`${root}/effect`)), 'seed');
    data.hostPassed = true;
  } else if (row.id === 'h02') {
    await putScript('script', './script');
    await expectLimit('./script', { maxSubstitutionDepth: 4, maxCommands: 128 }, 'maxSubstitutionDepth');
    data.hostPassed = true;
  } else if (row.id === 'h03') {
    let entered;
    let cleanupCount = 0;
    const ready = new Promise(resolve => { entered = resolve; });
    const reason = new Error('independent shebang cancellation');
    shell.register({ name: 'reviewhold', execute: async context => {
      let cleaning;
      const cleanup = () => cleaning ??= Promise.resolve().then(() => { cleanupCount++; });
      context.registerCleanup?.(cleanup);
      data.checks.cleanupHook = typeof context.registerCleanup === 'function';
      entered();
      try { await new Promise((_resolve, reject) => { if (context.signal.aborted) reject(context.signal.reason); else context.signal.addEventListener('abort', () => reject(context.signal.reason), { once: true }); }); }
      finally { await cleanup(); }
      return { exitCode: 0 };
    } });
    const pending = execute('./script');
    const settled = pending.then(() => 'settled', () => 'settled');
    assert.equal(await Promise.race([ready.then(() => 'entered'), settled]), 'entered');
    controller.abort(reason);
    await assert.rejects(pending, error => error === reason);
    assert.equal(cleanupCount, 1);
    assert.equal(data.checks.cleanupHook, true);
    assert.equal(new TextDecoder().decode(await fs.readFile(`${root}/effect`)), 'seed');
    data.checks.cleanupCountAtSettlement = cleanupCount;
    data.hostPassed = true;
  } else if (row.id === 'h04') {
    await putScript('script', 'cat');
    let release;
    const consumed = new Promise(resolve => { release = resolve; });
    shell.register({ name: 'reviewproduce', execute: async context => {
      await context.stdout.write(encoder.encode('a'));
      await consumed;
      await context.stdout.write(encoder.encode('b'));
      return { exitCode: 0 };
    } });
    shell.register({ name: 'reviewconsume', execute: async context => {
      for await (const bytes of context.stdin) { release(); await context.stdout.write(bytes); }
      return { exitCode: 0 };
    } });
    const result = await execute('reviewproduce | ./script | reviewconsume', { limits: { pipeHighWaterMark: 1 } });
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, 'ab');
    assert.equal(result.stderr, '');
    assert.ok(observations.some(entry => entry.command === 'env'));
    assert.ok(observations.some(entry => entry.command === 'cat'));
    data.hostPassed = true;
  } else if (row.id === 'h05') {
    await fs.writeFile(`${root}/script`, encoder.encode('#!/usr/bin/env -S -i KEEP=${TOKEN} reviewprobe\nprintf unsafe > effect\n'), { mode: 0o755 });
    const captures = [];
    shell.register({ name: 'reviewprobe', execute: async context => {
      const chunks = [];
      for await (const chunk of context.stdin) chunks.push(Buffer.from(chunk));
      captures.push({ args: [...context.args], env: { ...context.env }, stdin: Buffer.concat(chunks).toString(), origin: context.stdinIsDefault });
      return { exitCode: 0 };
    } });
    shell.register({ name: 'reviewbridge', execute: context => context.invoke('./script', ['literal;$(never)'], { replaceEnv: true, env: { TOKEN: 'child' }, stdin: (async function* () { yield encoder.encode('abc'); })(), stdinIsDefault: false }) });
    const result = await execute('reviewbridge; printf "%s" "$TOKEN"');
    data.checks.captures = captures;
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, 'two words');
    assert.equal(result.stderr, '');
    assert.deepEqual(captures, [{ args: ['./script', 'literal;$(never)'], env: { KEEP: 'child' }, stdin: 'abc', origin: false }]);
    assert.equal(new TextDecoder().decode(await fs.readFile(`${root}/effect`)), 'seed');
    data.hostPassed = true;
  } else if (row.id === 'h06') {
    await putScript('script', './inner');
    await putScript('inner', 'printf abc');
    await expectLimit('./script', { maxOutputBytes: 2 }, 'maxOutputBytes');
    data.hostPassed = true;
  } else assert.fail(`unknown case ${row.id}`);
} catch (error) {
  data.assertion = errorRecord(error);
} finally {
  clearTimeout(deadline);
  controller.abort(new Error('review final cleanup'));
  await shell.dispose();
  data.disposed = true;
}
async function snapshot(path, prefix = '') {
  const entries = [];
  for (const entry of (await fs.readdir(path)).sort((left, right) => left.name.localeCompare(right.name))) {
    const child = `${path}/${entry.name}`;
    const name = `${prefix}${entry.name}`;
    const stat = await fs.stat(child);
    entries.push({ path: name, type: stat.type, mode: stat.mode & 0o777, ...(stat.type === 'file' ? { base64: Buffer.from(await fs.readFile(child)).toString('base64') } : {}) });
    if (stat.type === 'directory') entries.push(...await snapshot(child, `${name}/`));
  }
  return entries;
}
data.effects = await snapshot(root);
hook.deregister();
process.stdout.write(JSON.stringify(data));
