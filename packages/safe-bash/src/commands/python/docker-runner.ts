import { createNodePythonWorker } from './node.js';
import type { PythonWorkerEndpoint } from './index.js';
import { encodePythonReply } from './reply.js';
import { PythonFailure } from './diagnostics.js';

export interface DockerPythonRunnerOptions {
  readonly isolatedContainer: true;
  readonly runtimeModuleURL: string;
  readonly indexURL?: string;
}

export async function runDockerPythonExecutor(options: DockerPythonRunnerOptions): Promise<void> {
  if (options.isolatedContainer !== true) throw new TypeError('The Python stdio runner requires an explicitly isolated container');
  const runtimeModuleURL = new URL(options.runtimeModuleURL);
  if (runtimeModuleURL.protocol !== 'file:') throw new TypeError('The isolated Python runtime must be present in its immutable image');
  const input = process.stdin;
  const output = process.stdout;
  let buffered = Buffer.alloc(0);
  let limit = 16777216;
  let endpoint: PythonWorkerEndpoint | undefined;
  let unsubscribe: (() => void) | undefined;
  let retirement: Promise<void> | undefined;
  let control: Int32Array<SharedArrayBuffer>;
  let payload: Uint8Array<SharedArrayBuffer>;
  let identifier = 0;
  let requesting = false;
  let finished = false;
  let resolveRun!: () => void;
  let rejectRun!: (error: unknown) => void;
  const completion = new Promise<void>((resolve, reject) => { resolveRun = resolve; rejectRun = reject; });
  const fail = () => { finished = true; rejectRun(new PythonFailure('transport-unavailable')); };
  const retire = () => retirement ??= Promise.resolve().then(async () => {
    finished = true;
    input.off('data', data);
    input.destroy();
    unsubscribe?.();
    await endpoint?.terminate();
  });
  const write = (value: unknown): Promise<void> => new Promise((resolve, reject) => {
    try { output.write(Buffer.concat([encodePythonReply(value, limit), Buffer.from('\n')]), error => error ? reject(error) : resolve()); }
    catch (error) { reject(error); }
  });
  const receive = (frame: any) => {
    if (endpoint) {
      if (!requesting || frame?.id !== identifier || ![1, 2].includes(frame.status)) throw new PythonFailure('transport-unavailable');
      const bytes = encodePythonReply(frame.value, payload.length);
      payload.set(bytes);
      requesting = false;
      Atomics.store(control, 1, bytes.length);
      Atomics.store(control, 0, frame.status);
      Atomics.notify(control, 0);
      return;
    }
    if (frame?.type !== 'start' || !Number.isSafeInteger(frame.maxTransferBytes) || frame.maxTransferBytes < 1 || frame.maxTransferBytes > 1048576
      || !Number.isSafeInteger(frame.maxFrameBytes) || frame.maxFrameBytes < 65536 || frame.maxFrameBytes > 16777216) throw new PythonFailure('transport-unavailable');
    limit = frame.maxFrameBytes;
    const shared = new SharedArrayBuffer(8 + frame.maxTransferBytes * 6 + 65536);
    control = new Int32Array(shared, 0, 2);
    payload = new Uint8Array(shared, 8);
    endpoint = createNodePythonWorker({ trustedPython: true, runtimeModuleURL: runtimeModuleURL.href,
      ...(options.indexURL === undefined ? {} : { indexURL: options.indexURL }) });
    unsubscribe = endpoint.subscribe(message => {
      if (finished) return;
      if (!message || typeof message !== 'object') { fail(); return; }
      const record = message as { op?: string; args?: unknown[]; type?: string };
      if (typeof record.op === 'string') {
        if (requesting) { fail(); return; }
        requesting = true;
        void write({ type: 'request', id: ++identifier, op: record.op, args: record.args }).catch(fail);
      } else {
        const terminal = record.type === 'exit' || record.type === 'error';
        if (terminal) finished = true;
        void write(message).then(() => { if (terminal) resolveRun(); }, rejectRun);
      }
    }, fail);
    endpoint.postMessage({ ...frame, shared });
  };
  const data = (chunk: Buffer) => {
    if (finished) return;
    try {
      if (buffered.length + chunk.length > limit + 1) throw new PythonFailure('transport-unavailable');
      buffered = Buffer.concat([buffered, chunk]);
      let end: number;
      while (!finished && (end = buffered.indexOf(10)) >= 0) {
        if (end > limit) throw new PythonFailure('transport-unavailable');
        const frame = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(buffered.subarray(0, end)));
        buffered = Buffer.from(buffered.subarray(end + 1));
        receive(frame);
      }
      if (buffered.length > limit) throw new PythonFailure('transport-unavailable');
    } catch { fail(); }
  };
  input.on('data', data);
  input.once('end', fail);
  input.once('close', fail);
  input.once('error', fail);
  output.once('error', fail);
  output.once('close', fail);
  try { await completion; }
  catch { await retire(); await write({ type: 'error', category: 'transport-unavailable' }); }
  finally {
    try { await retire(); }
    finally { input.off('end', fail); input.off('close', fail); input.off('error', fail); output.off('error', fail); output.off('close', fail); }
  }
}
