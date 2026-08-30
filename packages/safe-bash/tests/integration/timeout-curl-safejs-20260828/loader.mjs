import assert from 'node:assert/strict';
import { registerHooks, syncBuiltinESMExports } from 'node:module';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import tls from 'node:tls';
import dgram from 'node:dgram';
import dns from 'node:dns';

const root = fs.realpathSync(process.env.WORKFLOW_ROOT), binding = JSON.parse(fs.readFileSync(join(root, 'LOAD.json')));
const trace = process.env.WORKFLOW_TRACE;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
let traceBytes = 0, compiler;
function record(value) {
  const text = JSON.stringify(value) + '\n'; traceBytes += Buffer.byteLength(text);
  assert.ok(traceBytes <= 2097152, 'TRACE_BOUND'); fs.appendFileSync(trace, text);
}
const networkDenied = () => { record({ event: 'NETWORK_DENIED' }); throw new Error('NETWORK_FORBIDDEN'); };
globalThis.fetch = networkDenied;
for (const [target, keys] of [[http, ['request', 'get']], [https, ['request', 'get']], [net, ['connect', 'createConnection', 'createServer']], [tls, ['connect', 'createServer']], [dgram, ['createSocket']], [dns, ['lookup', 'resolve']]]) for (const key of keys) target[key] = networkDenied;
net.Socket.prototype.connect = networkDenied;
net.Server.prototype.listen = networkDenied;
for (const key of ['lookup', 'resolve']) dns.promises[key] = networkDenied;
globalThis.WebSocket = networkDenied;
syncBuiltinESMExports();
registerHooks({
  resolve(specifier, context, next) {
    if (specifier.startsWith('file:')) {
      const target = fileURLToPath(specifier);
      if (!target.startsWith(root + '/')) { record({ event: 'reject', kind: 'OUTSIDE_IMPORT', specifier }); throw new Error('OUTSIDE_IMPORT'); }
    }
    try { return next(specifier, context); }
    catch (error) {
      if (context.parentURL?.startsWith(pathToFileURL(join(root, 'node_modules/engine/')).href) && specifier.startsWith('.') && specifier.endsWith('.js')) {
        const target = new URL(specifier.slice(0, -3) + '.ts', context.parentURL);
        if (fs.existsSync(target)) return { url: target.href, shortCircuit: true };
      }
      throw error;
    }
  },
  load(url, context, next) {
    if (!url.startsWith('file:')) return next(url, context);
    const target = resolve(fileURLToPath(url));
    if (!target.startsWith(root + '/') || fs.realpathSync(target) !== target) throw new Error('OUTSIDE_IMPORT');
    const path = relative(root, target), expected = binding.files[path];
    if (!expected) { record({ event: 'reject', kind: 'UNBOUND_IMPORT', path }); throw new Error('UNBOUND_IMPORT'); }
    const bytes = fs.readFileSync(target), actual = hash(bytes);
    if (actual !== expected) { record({ event: 'reject', kind: 'LOAD_HASH', path, expected, actual }); throw new Error('LOAD_HASH'); }
    if (path.startsWith('node_modules/engine/') && !binding.engineClosure.includes(path)) throw new Error('UNAPPROVED_ENGINE_IMPORT');
    if (path.endsWith('.ts')) {
      assert.ok(path.startsWith('node_modules/engine/'), 'NO_PRODUCT_SOURCE_FALLBACK');
      assert.ok(compiler, 'COMPILER_READY');
      const source = compiler.transpileModule(bytes.toString(), { compilerOptions: { target: compiler.ScriptTarget.ES2023, module: compiler.ModuleKind.ESNext, verbatimModuleSyntax: true } }).outputText;
      record({ event: 'load', path, sha256: actual, method: 'explicit-engine-transform', emittedSHA256: hash(source) });
      return { format: 'module', source, shortCircuit: true };
    }
    const loaded = next(url, context);
    if (loaded.source !== undefined && loaded.source !== null) assert.equal(hash(typeof loaded.source === 'string' ? Buffer.from(loaded.source) : Buffer.from(loaded.source)), actual, 'NEXT_LOAD_BYTES');
    record({ event: 'load', path, sha256: actual, method: 'nextLoad', format: loaded.format });
    return loaded;
  },
});
compiler = (await import(pathToFileURL(join(root, 'node_modules/typescript/lib/typescript.js')))).default;
assert.equal(compiler.version, '5.9.3');
