import { open, lstat, readdir, readFile, writeFile, mkdir, copyFile, rename, chmod } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { dirname, resolve, relative, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const own = dirname(fileURLToPath(import.meta.url));
const repo = resolve(own, '../../..');
const [mode, label, sealName = 'SEAL.json'] = process.argv.slice(2);
if (!['seal', 'run'].includes(mode) || !/^[A-Z0-9-]{1,64}$/.test(label ?? '')) throw new Error('explicit mode and unique label required');
if (!/^SEAL(?:-v[2-9])?\.json$/.test(sealName)) throw new Error('exact versioned seal name required');
const start = Date.now();
const output = join(own, label);
await mkdir(output, { recursive: false });
const outer = await open(join(output, 'outer.jsonl'), 'wx', 0o644);
let bytes = 0, count = 0, active = 0, peak = 0;
const receipts = [];
const deadline = sealName === 'SEAL.json' ? start + (mode === 'seal' ? 10 : 45) * 60_000 : (await lstat(join(own, 'ACTUAL-01'))).birthtimeMs - 1000 + 45 * 60_000;
const sourceNames = ['types', 'errors', 'limits', 'syntax', 'matcher'];
const fixtures = ['driver.mjs', 'suite.mjs', 'cases.json', 'consumer.mts', 'negative.mts', 'RECIPE.md'];
async function event(value) { await outer.write(`${JSON.stringify({ elapsedMs: Date.now() - start, ...value })}\n`); }
function time() { if (Date.now() > deadline) throw new Error('SAFETY deadline exceeded'); }
async function hash(location, cap = 128 * 1024 * 1024) {
  const stat = await lstat(location);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > cap) throw new Error(`SAFETY nonregular/oversize input ${location}`);
  const digest = createHash('sha256');
  for await (const chunk of createReadStream(location, { highWaterMark: 65536 })) { time(); digest.update(chunk); }
  return { path: location, size: stat.size, mode: stat.mode & 0o777, sha256: digest.digest('hex') };
}
async function files(directory) {
  const stat = await lstat(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('SAFETY nonregular directory');
  const result = [];
  for (const name of (await readdir(directory)).sort()) {
    const location = join(directory, name); const entry = await lstat(location);
    if (entry.isSymbolicLink()) throw new Error(`SAFETY link refused ${location}`);
    if (entry.isDirectory()) result.push(...await files(location));
    else if (entry.isFile()) result.push(location);
    else throw new Error('SAFETY special input');
  }
  return result;
}
async function bound(entries) {
  for (const expected of entries) assert.deepEqual(await hash(expected.path), expected, `SAFETY input drift ${expected.path}`);
}
async function child(role, argv, cwd, timeout = 30_000) {
  time();
  if (++count > 90 || active >= 3) throw new Error('SAFETY child ceiling');
  const prefix = `${String(count).padStart(2, '0')}-${role}`;
  const stdout = await open(join(output, `${prefix}.stdout`), 'wx');
  const stderr = await open(join(output, `${prefix}.stderr`), 'wx');
  let timer, timedOut = false, streamFailure, capture = 0;
  const chunks = { stdout: [], stderr: [] };
  const pending = [];
  const processChild = spawn(process.execPath, argv, { cwd, env: { PATH: '/usr/bin:/bin', LANG: 'C', LC_ALL: 'C', HOME: join(output, 'home'), NODE_NO_WARNINGS: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
  active++; peak = Math.max(peak, active);
  const closed = new Promise(resolveClose => {
    processChild.once('error', error => { streamFailure = error; });
    processChild.once('close', (code, signal) => { active--; clearTimeout(timer); resolveClose({ code, signal }); });
  });
  for (const [channel, handle] of [['stdout', stdout], ['stderr', stderr]]) {
    processChild[channel].on('data', chunk => {
      bytes += chunk.length; capture += chunk.length;
      if (capture > 16 * 1024 * 1024 || bytes > 128 * 1024 * 1024) { streamFailure ??= new Error('SAFETY capture cap'); processChild.kill('SIGKILL'); return; }
      chunks[channel].push(chunk);
      const writing = handle.write(chunk).catch(error => { streamFailure ??= error; processChild.kill('SIGKILL'); });
      pending.push(writing);
    });
  }
  timer = setTimeout(() => { timedOut = true; processChild.kill('SIGKILL'); }, Math.min(timeout, Math.max(1, deadline - Date.now())));
  let launchFailure;
  try { await event({ event: 'spawn', role, pid: processChild.pid ?? null, argv, cwd }); }
  catch (error) { launchFailure = error; processChild.kill('SIGKILL'); }
  const terminal = await closed;
  await Promise.all(pending); await stdout.close(); await stderr.close();
  const result = { role, argv, cwd, pid: processChild.pid ?? null, ...terminal, timedOut, capture, retired: true };
  receipts.push(result); await event({ event: 'close', ...result });
  if (launchFailure || streamFailure || timedOut || terminal.signal) throw launchFailure ?? streamFailure ?? new Error('SAFETY abnormal child retirement');
  time();
  return { ...result, stdout: Buffer.concat(chunks.stdout).toString('utf8'), stderr: Buffer.concat(chunks.stderr).toString('utf8') };
}
const tscFlags = ['--target', 'ES2023', '--lib', 'ES2023', '--module', 'NodeNext', '--moduleResolution', 'NodeNext', '--strict', '--noUncheckedIndexedAccess', '--exactOptionalPropertyTypes', '--verbatimModuleSyntax', '--skipLibCheck', '--types', 'node'];
try {
  await event({ event: 'start', mode, label, pid: process.pid, node: process.execPath, version: process.version });
  if (mode === 'seal') {
    const sources = [];
    for (const name of sourceNames) sources.push(await hash(join(repo, `src/commands/regex-execution/ere/${name}.ts`)));
    const inputs = [];
    for (const name of fixtures) inputs.push(await hash(join(own, name)));
    const toolRoots = ['node_modules/typescript/lib', 'node_modules/@types/node', 'node_modules/undici-types'];
    const tools = [];
    for (const root of toolRoots) for (const location of await files(join(repo, root))) tools.push(await hash(location));
    for (const location of ['node_modules/typescript/package.json', 'node_modules/undici-types/package.json']) {
      if (!tools.some(entry => entry.path === join(repo, location))) tools.push(await hash(join(repo, location)));
    }
    const seal = { version: 1, baseline: '7a5c620005fb04518d44bb284f4e99284e4a7c33', derived: '74dfe69135a3fc5ba89396b20dd32d9c9daae131', standaloneOnly: true, node: await hash(process.execPath), sources, inputs, tools, compiler: join(repo, 'node_modules/typescript/lib/tsc.js'), tscFlags, noWorkers: true, noShellIntegration: true, limits: { children: 90, peak: 3, capture: 134217728, working: 805306368, elapsedMs: 2700000 } };
    await writeFile(join(own, sealName), `${JSON.stringify(seal, null, 2)}\n`, { flag: 'wx' });
    await event({ event: 'sealed', sources: sources.length, fixtures: inputs.length, tools: tools.length, seal: await hash(join(own, sealName)) });
  } else {
    const seal = JSON.parse(await readFile(join(own, sealName), 'utf8'));
    await bound([seal.node, ...seal.sources, ...seal.inputs, ...seal.tools]);
    const work = join(output, 'work'); await mkdir(work);
    for (const entry of seal.tools) {
      const destination = join(work, relative(repo, entry.path));
      await mkdir(dirname(destination), { recursive: true }); await copyFile(entry.path, destination); await chmod(destination, entry.mode);
      const copied = await hash(destination); assert.equal(copied.sha256, entry.sha256); assert.equal(copied.size, entry.size);
    }
    const source = join(work, 'source'); await mkdir(source);
    for (const entry of seal.sources) await copyFile(entry.path, join(source, relative(join(repo, 'src/commands/regex-execution/ere'), entry.path)));
    await writeFile(join(source, 'package.json'), '{"type":"module","private":true}\n');
    const compiler = join(work, relative(repo, seal.compiler));
    const typeRoots = join(work, 'node_modules/@types');
    const build = await child('strict-build', [compiler, ...tscFlags, '--typeRoots', typeRoots, '--declaration', '--outDir', join(work, 'emitted'), ...sourceNames.map(name => join(source, `${name}.ts`))], work, 120_000);
    if (build.code !== 0) throw new Error('ORDINARY strict build failed; dependent execution not admitted');
    const emitted = join(work, 'emitted');
    await writeFile(join(emitted, 'package.json'), '{"type":"module","private":true}\n');
    const emittedBinding = [];
    for (const location of await files(emitted)) emittedBinding.push(await hash(location));
    const rows = [];
    function resultRows(result, role, expectedFailure = false) {
      const records = result.stdout.split('\n').filter(Boolean).map(line => JSON.parse(line));
      const results = records.find(record => record.event === 'results');
      const loads = records.find(record => record.event === 'loaded');
      if (!results || !loads || results.rows.length === 0 || result.code !== (results.fail ? 1 : 0)) throw new Error('SAFETY incomplete result or exit/count disagreement');
      rows.push({ role, expectedFailure, results, loads, exitCode: result.code });
      return results;
    }
    async function suite(role, directory, selected = 'all', expectedFailure = false) {
      return resultRows(await child(role, [join(own, 'suite.mjs'), directory, join(own, 'cases.json'), selected], work), role, expectedFailure);
    }
    await suite('source-build', emitted);
    const app = join(work, 'installed-app');
    const artifact = join(app, 'artifact'); await mkdir(artifact, { recursive: true });
    for (const entry of emittedBinding) await copyFile(entry.path, join(artifact, relative(emitted, entry.path)));
    await writeFile(join(app, 'package.json'), '{"type":"module","private":true}\n');
    await copyFile(join(own, 'consumer.mts'), join(app, 'consumer.mts')); await copyFile(join(own, 'negative.mts'), join(app, 'negative.mts'));
    await suite('installed-artifact', artifact);
    const types = [];
    for (const layout of ['source', 'installed', 'moved']) {
      const target = layout === 'moved' ? join(work, 'physically-moved-app') : app;
      if (layout === 'moved') { await rename(app, target); await assert.rejects(lstat(app), error => error.code === 'ENOENT'); await suite('physically-moved-artifact', join(target, 'artifact')); }
      const positive = await child(`types-${layout}-positive`, [compiler, ...tscFlags, '--typeRoots', typeRoots, '--noEmit', join(target, 'consumer.mts')], work, 120_000);
      const negative = await child(`types-${layout}-negative`, [compiler, ...tscFlags, '--typeRoots', typeRoots, '--noEmit', join(target, 'negative.mts')], work, 120_000);
      const diagnostics = [...negative.stdout.matchAll(/error TS(\d+):/g)].map(match => Number(match[1]));
      types.push({ layout, positiveExit: positive.code, negativeExit: negative.code, diagnostics, pass: positive.code === 0 && negative.code === 2 && JSON.stringify(diagnostics) === JSON.stringify([2345,2339,2322]) });
    }
    const mutations = [
      ['M01-first-tie', 'matcher', 'if (compared !== 0)\n            return compared > 0;', 'if (compared !== 0)\n            return false;', 'E04'],
      ['M02-ascii', 'syntax', 'if (code === 0 || code > 127)', 'if (false)', 'R14'],
      ['M03-nullable', 'syntax', 'if (child.nullable && child.captured && max > 1)', 'if (false)', 'R11'],
      ['M04-captures', 'matcher', 'captures: Object.freeze(captures)', 'captures: Object.freeze(captures.slice(0, 1))', 'E08'],
      ['M05-poison', 'limits', 'if (this.#poison)\n            throw this.#poison;', 'if (false)\n            throw this.#poison;', 'all'],
      ['M06-storage', 'matcher', 'ledger.charge("captureSlots", width, signal);', 'void width;', 'all'],
      ['M07-history', 'matcher', 'const leftCount = left?.count ?? 0;', 'return spanOrder(left?.span ?? null, right?.span ?? null);\n    const leftCount = left?.count ?? 0;', 'E28'],
      ['M08-binding', 'syntax', 'if (!entry || entry.ledger !== ledger)', 'if (!entry)', 'all'],
    ];
    const mutantResults = [];
    for (const [id, name, before, after, selected] of mutations) {
      const location = join(emitted, `${name}.js`); const original = await readFile(location, 'utf8');
      if (original.split(before).length !== 2) { mutantResults.push({ id, activated: false, reason: 'exact mutation marker absent' }); continue; }
      await writeFile(location, original.replace(before, after));
      let observed;
      try { observed = await suite(id, emitted, selected, true); }
      finally { await writeFile(location, original); }
      await bound(emittedBinding);
      const restored = await suite(`${id}-restore`, emitted, selected);
      mutantResults.push({ id, activated: true, killed: observed.fail > 0, restored: restored.fail === 0 });
    }
    await bound([seal.node, ...seal.sources, ...seal.inputs, ...seal.tools, ...emittedBinding]);
    const census = [];
    let workBytes = 0;
    for (const location of await files(work)) { const record = await hash(location); workBytes += record.size; census.push(record); }
    if (workBytes > seal.limits.working) throw new Error('SAFETY working storage cap');
    const result = { baseline: seal.baseline, standaloneOnly: true, rows, types, mutantResults, emittedBinding, census, workBytes, receipts, knownChildren: count, peak, captureBytes: bytes, elapsedMs: Date.now() - start, active, integration: 'UNRUN', native: 'UNRUN', installedQualification: 'regular-file installed artifact; no npm installation or whole-package claim' };
    await writeFile(join(output, 'RESULT.json'), `${JSON.stringify(result, null, 2)}\n`);
    const failed = rows.some(row => !row.expectedFailure && row.results.fail) || types.some(row => !row.pass) || mutantResults.some(row => !row.activated || !row.killed || !row.restored);
    await event({ event: 'complete', failed, knownChildren: count, active, peak, workBytes, captureBytes: bytes });
    if (failed) process.exitCode = 1;
  }
} catch (error) {
  await event({ event: 'failure', error: String(error?.stack ?? error), active, count, peak, receipts });
  process.exitCode = 1;
} finally {
  await event({ event: 'retirement', active, count, peak, captureBytes: bytes, elapsedMs: Date.now() - start });
  await outer.close();
  if (active) process.exitCode = 78;
}
