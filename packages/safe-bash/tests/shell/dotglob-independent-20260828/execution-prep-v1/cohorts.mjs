import assert from 'node:assert/strict';
import { join } from 'node:path';
import { json } from './artifacts.mjs';
import { frozenRoot, commandScript, onSetup } from './plan.mjs';

const encoder = new TextEncoder();
export function exactResult(result, expected) {
  assert.equal(result.exitCode, expected.exitCode);
  assert.equal(result.stdout, expected.stdout);
  assert.equal(result.stderr, expected.stderr);
  assert.deepEqual([...result.stdoutBytes], [...encoder.encode(expected.stdout)]);
  assert.deepEqual([...result.stderrBytes], [...encoder.encode(expected.stderr)]);
}
export async function fixture(api, resources, name = 'basic', extraFiles = {}, options = {}) {
  const definition = json(join(frozenRoot, 'glob-fixtures.json'))[name];
  assert.ok(definition);
  const fs = new api.MemoryFileSystem();
  for (const path of definition.directories) await fs.mkdir(path, { recursive: true });
  for (const [path, text] of Object.entries({ ...definition.files, ...extraFiles })) await fs.writeFile(path, encoder.encode(text));
  const raw = Object.fromEntries(['readdir', 'stat', 'readFile'].map(name => [name, fs[name].bind(fs)]));
  const events = [];
  const snapshot = async () => {
    const rows = [];
    async function visit(path) {
      const stat = await raw.stat(path);
      rows.push({ path, type: stat.type, mode: stat.mode, ...(stat.type === 'file' ? { bytes: [...await raw.readFile(path)] } : {}) });
      if (stat.type === 'directory') for (const entry of (await raw.readdir(path)).sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0)) await visit(path === '/' ? `/${entry.name}` : `${path}/${entry.name}`);
    }
    await visit('/');
    return rows;
  };
  fs.readdir = async (path, options) => {
    events.push({ method: 'readdir', path });
    const entries = await raw.readdir(path, options);
    if (definition.readdirOverride?.path !== path) return entries;
    return definition.readdirOverride.entryNames.map(name => name === '.' || name === '..' ? { name, type: 'directory' } : entries.find(entry => entry.name === name));
  };
  fs.stat = async (path, options) => { events.push({ method: 'stat', path }); return raw.stat(path, options); };
  const shell = resources.own(new api.Shell({ fs, cwd: definition.cwd, env: { LC_ALL: 'C', TZ: 'UTC' }, limits: { maxCommands: 128, maxOutputBytes: 32768, maxExpansionFields: 256, maxExpansionBytes: 8192, maxLoopIterations: 64 }, ...options }));
  shell.use(api.agentCommands());
  return { shell, fs, raw, snapshot, events };
}
export async function commandCase(api, row, resources) {
  const { shell, snapshot, events } = await fixture(api, resources);
  const before = await snapshot(), receipts = [];
  const setup = [];
  shell.register({ name: '__dg_setup', execute(context) { setup.push([...context.args]); return { exitCode: 0 }; } });
  shell.register({ name: '__dg_receipt', execute(context) { receipts.push([...context.args]); return { exitCode: 0 }; } });
  const result = await shell.exec(commandScript(row));
  const after = await snapshot();
  assert.deepEqual(setup, row.initial === 'on' ? [['0'], ['0']] : [], 'on setup really succeeds and queries enabled; off uses fresh default');
  assert.deepEqual(after, before, 'literal builtin leaves VFS unchanged');
  assert.deepEqual(receipts, [[String(row.exitCode), row.postState === 'on' ? '0' : '1']], 'command status and same-exec state receipt');
  exactResult(result, { ...row, exitCode: 0 });
  assert.deepEqual(events, [], 'literal builtin arguments need no VFS lookup');
  return { wrapperExit: result.exitCode, setup, receipts, stdoutHex: Buffer.from(result.stdoutBytes).toString('hex'), stderrHex: Buffer.from(result.stderrBytes).toString('hex'), before, after, events };
}
export async function globCase(api, row, resources) {
  const { shell, snapshot, events } = await fixture(api, resources, row.fixture);
  const before = await snapshot(), calls = [];
  const setup = [];
  shell.register({ name: '__dg_setup', execute(context) { setup.push([...context.args]); return { exitCode: 0 }; } });
  shell.register({ name: 'capture', execute(context) { calls.push([...context.args]); return { exitCode: 0 }; } });
  const result = await shell.exec(`${onSetup(row.state)}capture ${row.word}`, row.cwd ? { cwd: row.cwd } : {});
  assert.deepEqual(setup, row.state === 'on' ? [['0'], ['0']] : []);
  exactResult(result, { stdout: '', stderr: '', exitCode: 0 });
  assert.deepEqual(calls, [row.expectedArgs]);
  if (row.expectedReaddirCalls !== undefined) assert.equal(events.filter(event => event.method === 'readdir').length, row.expectedReaddirCalls);
  if (row.expectedStatCalls !== undefined) assert.equal(events.filter(event => event.method === 'stat').length, row.expectedStatCalls);
  const after = await snapshot();
  assert.deepEqual(after, before);
  return { calls, events, before, after };
}
export async function stateCase(api, row, resources) {
  const { shell, snapshot } = await fixture(api, resources, 'basic', row.files ?? {});
  const before = await snapshot();
  const result = await shell.exec(row.script);
  exactResult(result, row);
  const after = await snapshot();
  assert.deepEqual(after, before);
  return { stdoutHex: Buffer.from(result.stdoutBytes).toString('hex'), stderrHex: Buffer.from(result.stderrBytes).toString('hex'), exitCode: result.exitCode, before, after };
}
