import { parentPort, workerData, threadId } from 'node:worker_threads';
import { createRequire, syncBuiltinESMExports } from 'node:module';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const threads = require('node:worker_threads');
const NativeWorker = threads.Worker;
let workerAdmissions = 0;
threads.Worker = class extends NativeWorker {
  constructor(...args) { workerAdmissions++; super(...args); }
};
syncBuiltinESMExports();
const NativeRegExp = globalThis.RegExp;
const compilations = [];
globalThis.RegExp = new Proxy(NativeRegExp, {
  construct(target, args) { compilations.push(String(args[0])); return Reflect.construct(target, args); },
  apply(target, receiver, args) { compilations.push(String(args[0])); return Reflect.apply(target, receiver, args); },
});
const { createExprCommand } = await import(pathToFileURL(join(workerData.installed, 'dist/commands/expr/index.js')).href);
const stdout = [];
const stderr = [];
let bytes = 0;
const sink = target => ({ async write(chunk) { bytes += chunk.length; if (bytes > 8192) throw new Error('outer output bound'); target.push(Buffer.from(chunk)); } });
if (workerData.argv.reduce((sum, value) => sum + Buffer.byteLength(value), 0) > 4096) throw new Error('outer argument bound');
const result = await createExprCommand().execute({ command: 'expr', args: workerData.argv, env: { LC_ALL: 'C' }, cwd: '/', signal: new AbortController().signal, get stdin() { throw new Error('unexpected stdin'); }, fs: new Proxy({}, { get() { throw new Error('unexpected FS'); } }), stdout: sink(stdout), stderr: sink(stderr) });
parentPort.postMessage({ threadId, workerAdmissions, compilationArguments: compilations, exitCode: result.exitCode, stdoutBase64: Buffer.concat(stdout).toString('base64'), stderrBase64: Buffer.concat(stderr).toString('base64'), outerWorkerOnly: true });
