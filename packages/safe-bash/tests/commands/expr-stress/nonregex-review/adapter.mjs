import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { sha256 } from './prepare.mjs';

export async function bind(installed) {
  const modulePath = join(installed, 'dist/commands/expr/index.js');
  const rootPath = join(installed, 'dist/index.js');
  const expr = await import(pathToFileURL(modulePath).href);
  const api = await import(pathToFileURL(rootPath).href);
  assert.equal(api.createExprCommand, undefined);
  assert(!api.createStandardCommands().some(command => command.name === 'expr'));
  const records = [];
  async function direct(args, options = {}, extra = {}) {
    const counters = { stdinGetter: 0, iterator: 0, next: 0, return: 0, throw: 0, fs: 0, invoke: 0, cleanup: 0 };
    const output = [];
    const errors = [];
    const retained = [];
    const sourceKind = extra.stdinKind ?? 'explicit';
    const originalSource = sourceKind === 'binary' ? api.toByteSource(new Uint8Array([0, 255, 128, 10]))
      : sourceKind === 'never-ending' ? { async *[Symbol.asyncIterator]() { while (true) yield new Uint8Array([255]); } }
      : api.toByteSource(sourceKind === 'implicit' ? '' : 'explicit input');
    const guardedSource = new Proxy(originalSource, { get(target, property) {
      const counter = property === Symbol.asyncIterator ? 'iterator' : ['next', 'return', 'throw'].includes(property) ? property : undefined;
      if (counter) { counters[counter]++; throw new Error(`stdin ${counter} accessed`); }
      return Reflect.get(target, property);
    } });
    const context = Object.freeze({
      command: 'expr', args: Object.freeze([...args]), cwd: '/', env: Object.freeze({ LC_ALL: 'C', ...extra.env }),
      get stdin() { counters.stdinGetter++; return guardedSource; },
      stdinIsDefault: extra.stdinIsDefault ?? false,
      fs: new Proxy({}, { get() { counters.fs++; throw new Error('FS accessed'); } }),
      invoke: async () => { counters.invoke++; throw new Error('invoke accessed'); },
      registerCleanup: () => { counters.cleanup++; },
      signal: extra.signal ?? new AbortController().signal,
      stdout: { async write(chunk) { assert(chunk instanceof Uint8Array); retained.push([chunk, Buffer.from(chunk)]); output.push(Buffer.from(chunk)); if (extra.stdout) await extra.stdout(chunk); } },
      stderr: { async write(chunk) { assert(chunk instanceof Uint8Array); retained.push([chunk, Buffer.from(chunk)]); errors.push(Buffer.from(chunk)); if (extra.stderr) await extra.stderr(chunk); } },
    });
    let status = null;
    let rejection;
    let rejected = false;
    try { status = (await expr.createExprCommand(options).execute(context)).exitCode; }
    catch (error) { rejected = true; rejection = error; }
    for (const [chunk, copy] of retained) assert.deepEqual(Buffer.from(chunk), copy, 'retained output mutated');
    const observation = { argv: [...args], options, environment: context.env, sourceKind, stdinIsDefault: context.stdinIsDefault, status, stdoutBase64: Buffer.concat(output).toString('base64'), stderrBase64: Buffer.concat(errors).toString('base64'), signal: null, failure: rejected ? { type: typeof rejection, message: String(rejection) } : null, counters };
    records.push(observation);
    return { ...observation, rejected, rejection };
  }
  const shell = (options = {}) => new api.Shell({ fs: new api.MemoryFileSystem(), env: { LC_ALL: 'C' }, ...options }).use(api.standardCommands()).use(expr.exprCommands());
  return { expr, api, direct, shell, records, identity: { modulePath, moduleSha256: sha256(readFileSync(modulePath)), rootPath, rootSha256: sha256(readFileSync(rootPath)), internalFileImportNotPublicSubpath: true, rootExprExport: false, defaultExprCommand: false } };
}
