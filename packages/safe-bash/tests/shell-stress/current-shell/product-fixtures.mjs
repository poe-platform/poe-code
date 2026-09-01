import assert from 'node:assert/strict';
import { resolve, dirname } from 'node:path';
import { Shell } from '../../../src/shell/index.ts';
import { MemoryFileSystem } from '../../../src/fs/memory/index.ts';
import { standardCommands } from '../../../src/commands/index.ts';
import { environment } from './support.mjs';

async function setup(files = {}, filesystem) {
  const fs = filesystem ?? new MemoryFileSystem();
  for (const path of ['/fixture/work', '/fixture/search']) await fs.mkdir(path, { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    const path = resolve('/fixture', name);
    await fs.mkdir(dirname(path), { recursive: true });
    await fs.writeFile(path, Buffer.from(content));
  }
  const shell = new Shell({ fs, cwd: '/fixture', env: { ...environment, HOME: '/fixture', PATH: '/fixture/bin' } });
  shell.use(standardCommands());
  return { fs, shell };
}

async function effects(fs) {
  const files = {};
  async function visit(path) {
    const entries = await fs.readdir(path);
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      const full = `${path}/${entry.name}`;
      const key = full.slice('/fixture/'.length);
      const stat = await fs.stat(full);
      if (stat.type === 'directory') { files[`${key}/`] = null; await visit(full); }
      else files[key] = Buffer.from(await fs.readFile(full)).toString('base64');
    }
  }
  await visit('/fixture');
  return files;
}

function errorRecord(error) {
  return { name: error?.name ?? typeof error, message: error?.message ?? String(error), ...(error?.limit ? { limit: error.limit } : {}), ...(error?.code ? { code: error.code } : {}), ...(error?.actual !== undefined ? { actual: error.actual } : {}), ...(error?.expected !== undefined ? { expected: error.expected } : {}) };
}

async function nativeRow(fixture) {
  const { fs, shell } = await setup(fixture.files);
  try {
    const result = await shell.exec(fixture.script, fixture.stdin === undefined ? {} : { stdin: fixture.stdin });
    return { status: result.exitCode, stdout: Buffer.from(result.stdoutBytes).toString('base64'), stderr: Buffer.from(result.stderrBytes).toString('base64'), files: await effects(fs) };
  } finally { await shell.dispose(); }
}

async function provenanceRow(fixture) {
  const observations = [];
  for (const mode of ['default', 'supplied', 'explicit-empty', 'redirected', 'piped']) {
    const { shell } = await setup({ 'probe.sh': 'take\n', 'input.txt': 'AB' });
    const seen = [];
    shell.register({ name: 'take', async execute(context) {
      const next = await context.stdin[Symbol.asyncIterator]().next();
      seen.push({ flag: context.stdinIsDefault, text: next.done ? '' : Buffer.from(next.value).toString() });
      return { exitCode: 0 };
    } });
    const operation = fixture.operation === 'source' ? 'source ./probe.sh' : "eval 'take'";
    const body = `${operation}; take`;
    const script = mode === 'redirected' ? `{ ${body}; } < ./input.txt` : mode === 'piped' ? `printf AB | { ${body}; }` : body;
    const stdin = mode === 'supplied' ? (async function* () { yield Buffer.from('A'); yield Buffer.from('B'); })() : mode === 'explicit-empty' ? '' : undefined;
    try {
      const result = await shell.exec(script, stdin === undefined ? {} : { stdin });
      const expected = mode === 'default' ? [{ flag: true, text: '' }, { flag: true, text: '' }] : mode === 'supplied' ? [{ flag: false, text: 'A' }, { flag: false, text: 'B' }] : mode === 'explicit-empty' ? [{ flag: false, text: '' }, { flag: false, text: '' }] : [{ flag: false, text: 'AB' }, { flag: false, text: '' }];
      observations.push({ mode, status: result.exitCode, stdout: result.stdout, stderr: result.stderr, seen, expected });
    } finally { await shell.dispose(); }
  }
  return { observations, passed: observations.every(row => row.status === 0 && row.stdout === '' && row.stderr === '' && JSON.stringify(row.seen) === JSON.stringify(row.expected)) };
}

async function cancellationRow(fixture) {
  const controller = new AbortController();
  const reason = new Error(`independent-${fixture.id}`);
  let suppliedSignal;
  let markerCalls = 0;
  let workStarted = false;
  let abortTimer;
  const pending = signal => {
    workStarted = true;
    suppliedSignal = signal;
    abortTimer = setTimeout(() => controller.abort(reason), 20);
    return new Promise((resolvePending, rejectPending) => {
      if (!signal) { rejectPending(new Error('No host cancellation signal')); return; }
      if (signal.aborted) rejectPending(signal.reason);
      else signal.addEventListener('abort', () => rejectPending(signal.reason), { once: true });
    });
  };
  class CancelFs extends MemoryFileSystem {
    async readFile(path, options) {
      if (path === '/fixture/cancel.sh') return pending(options?.signal);
      return super.readFile(path, options);
    }
  }
  const { shell } = await setup({ 'cancel.sh': 'marker\n' }, fixture.kind === 'cancel-source' ? new CancelFs() : undefined);
  shell.register({ name: 'marker', execute() { markerCalls++; return { exitCode: 0 }; } });
  shell.register({ name: 'pending', async execute(context) { await pending(context.signal); return { exitCode: 0 }; } });
  let caught;
  let result;
  try {
    result = await shell.exec(fixture.kind === 'cancel-source' ? 'source ./cancel.sh; marker' : "eval 'pending; marker'; marker", { signal: controller.signal });
  } catch (error) { caught = error; }
  finally { clearTimeout(abortTimer); await shell.dispose(); }
  return { passed: workStarted && suppliedSignal?.aborted === true && suppliedSignal.reason === reason && caught === reason && markerCalls === 0, workStarted, receivedSignal: suppliedSignal !== undefined, signalAborted: suppliedSignal?.aborted ?? false, exactReason: caught === reason, markerCalls, ...(caught ? { error: errorRecord(caught) } : {}), ...(result ? { result: { status: result.exitCode, stdout: result.stdout, stderr: result.stderr } } : {}) };
}

async function budgetRow(fixture) {
  const { shell } = await setup(fixture.files);
  let caught;
  let result;
  let observedOutput = '';
  let observedError = '';
  const attemptedPrintf = [];
  if (fixture.limit === 'maxOutputBytes') {
    await shell.exec('');
    const original = shell.commands.get('printf');
    assert.ok(original);
    shell.register({ name: 'printf', async execute(context) {
      attemptedPrintf.push([...context.args]);
      return original.execute(context);
    } }, { replace: true });
  }
  try {
    result = await shell.exec(fixture.script, { limits: { [fixture.limit]: fixture.value }, stdout: { async write(bytes) { observedOutput += Buffer.from(bytes).toString(); } }, stderr: { async write(bytes) { observedError += Buffer.from(bytes).toString(); } } });
  } catch (error) { caught = error; }
  finally { await shell.dispose(); }
  const outputWitness = fixture.limit !== 'maxOutputBytes' || (JSON.stringify(attemptedPrintf) === JSON.stringify([['1234'], ['5678'], ['90AB']]) && observedOutput === '12345678' && observedError === '');
  return { passed: caught?.name === 'ShellLimitError' && caught?.limit === fixture.limit && outputWitness, expected: { name: 'ShellLimitError', limit: fixture.limit }, observedOutput, observedError, ...(fixture.limit === 'maxOutputBytes' ? { attemptedPrintf, outputWitness } : {}), ...(caught ? { error: errorRecord(caught) } : {}), ...(result ? { result: { status: result.exitCode, stdout: result.stdout, stderr: result.stderr } } : {}) };
}


export async function runFixture(fixture) {
  try {
    return await (fixture.kind === 'provenance' ? provenanceRow(fixture) : fixture.kind?.startsWith('cancel-') ? cancellationRow(fixture) : fixture.kind === 'limit' ? budgetRow(fixture) : nativeRow(fixture));
  } catch (error) { return { passed: false, error: errorRecord(error) }; }
}
