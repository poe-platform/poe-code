import http from 'node:http';
import { randomUUID } from 'node:crypto';
import type { Duplex } from 'node:stream';
import type { PythonAsyncExecutor, PythonExecutorStart } from './index.js';
import { createPythonExecutorPool, type PythonExecutorPool } from './executor-pool.js';
import { PythonFailure, isPythonFailureCategory } from './diagnostics.js';
import { encodePythonReply } from './reply.js';
import { isErrnoCode } from '../../contracts/errors.js';

export { runDockerPythonExecutor } from './docker-runner.js';
export type { DockerPythonRunnerOptions } from './docker-runner.js';

export interface DockerPythonExecutorOptions {
  readonly socketPath: string;
  readonly image: string;
  readonly memoryBytes: number;
  readonly cpus: number;
  readonly deadlineMs: number;
  readonly maxConcurrentExecutors: number;
  readonly temporaryBytes?: number;
  readonly controlTimeoutMs?: number;
  readonly maxFrameBytes?: number;
}

class DockerControlFailure extends Error {
  constructor(readonly status?: number) { super('Container control request failed'); }
}

function boundedInteger(value: number, minimum: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) throw new RangeError('Invalid Python container resource limit');
  return value;
}

export async function createDockerPythonExecutorPool(options: DockerPythonExecutorOptions): Promise<PythonExecutorPool> {
  if (typeof options?.socketPath !== 'string' || !options.socketPath.startsWith('/') || options.socketPath.includes('\0')) throw new TypeError('An explicit Docker Unix socket is required');
  if (typeof options.image !== 'string' || !options.image.startsWith('sha256:') || options.image.length !== 71
    || [...options.image.slice(7)].some(character => !'0123456789abcdef'.includes(character))) throw new TypeError('An immutable Docker image ID is required');
  const configuration = Object.freeze({
    socketPath: options.socketPath, image: options.image,
    memoryBytes: boundedInteger(options.memoryBytes, 67108864, Number.MAX_SAFE_INTEGER),
    cpus: options.cpus,
    deadlineMs: boundedInteger(options.deadlineMs, 1, 86400000),
    maxConcurrentExecutors: boundedInteger(options.maxConcurrentExecutors, 1, Number.MAX_SAFE_INTEGER),
    temporaryBytes: boundedInteger(options.temporaryBytes ?? 16777216, 1, Number.MAX_SAFE_INTEGER),
    controlTimeoutMs: boundedInteger(options.controlTimeoutMs ?? 10000, 1, 300000),
    maxFrameBytes: boundedInteger(options.maxFrameBytes ?? 8388608, 65536, 16777216),
  });
  if (!Number.isFinite(configuration.cpus) || configuration.cpus < 0.01 || configuration.cpus > 64) throw new RangeError('Invalid Python container CPU quota');

  const request = (method: string, path: string, body?: unknown): Promise<{ status: number; value: any }> => new Promise((resolve, reject) => {
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const control = http.request({ socketPath: configuration.socketPath, method, path: '/v1.45' + path,
      headers: payload === undefined ? {} : { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
    }, response => {
      const chunks: Buffer[] = [];
      let size = 0;
      response.on('data', chunk => {
        size += chunk.length;
        if (size > 1048576) { control.destroy(new DockerControlFailure()); return; }
        chunks.push(Buffer.from(chunk));
      });
      response.once('error', () => reject(new DockerControlFailure()));
      response.once('aborted', () => reject(new DockerControlFailure()));
      response.once('end', () => {
        const status = response.statusCode ?? 0;
        try {
          const value = size ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : undefined;
          resolve({ status, value });
        } catch { reject(new DockerControlFailure(status)); }
      });
    });
    control.once('error', () => reject(new DockerControlFailure()));
    control.setTimeout(configuration.controlTimeoutMs, () => control.destroy(new DockerControlFailure()));
    control.end(payload);
  });

  try {
    const information = await request('GET', '/info');
    if (information.status !== 200 || information.value?.OSType !== 'linux'
      || !['MemoryLimit', 'SwapLimit', 'CpuCfsQuota', 'PidsLimit'].every(key => information.value[key] === true)
      || !Array.isArray(information.value.SecurityOptions)
      || !information.value.SecurityOptions.includes('name=seccomp,profile=builtin')) throw new PythonFailure('isolation-unavailable');
    const image = await request('GET', '/images/' + encodeURIComponent(configuration.image) + '/json');
    if (image.status !== 200 || image.value?.Id !== configuration.image
      || image.value.Config?.Labels?.['org.poe-platform.python-executor'] !== '1'
      || Object.keys(image.value.Config?.Volumes ?? {}).length) throw new PythonFailure('isolation-unavailable');
  } catch { throw new PythonFailure('isolation-unavailable'); }

  return createPythonExecutorPool({ maxConcurrentExecutors: configuration.maxConcurrentExecutors, createExecutor(): PythonAsyncExecutor {
    const name = 'poe-python-' + randomUUID();
    let container: string | undefined;
    let creationUnconfirmed = false;
    let initialization: Promise<void> | undefined;
    let retirement: Promise<void> | undefined;
    let socket: Duplex | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let start: PythonExecutorStart | undefined;
    let settled = false;
    let retired = false;
    let requesting = false;
    let ready = false;
    let admitted = false;
    let requestId = 0;
    const pending = new Set<Promise<void>>();
    let resolveRun: (status: number) => void;
    let rejectRun: (reason: unknown) => void;
    const fail = (reason: unknown) => { if (!settled) { settled = true; rejectRun?.(reason); } };
    const aborted = () => fail(start!.signal.reason);
    const send = (message: unknown, startup = false): Promise<void> => new Promise((resolve, reject) => {
      if (retired || settled || !socket || socket.destroyed) { reject(new PythonFailure('transport-unavailable')); return; }
      let bytes: Uint8Array;
      try { bytes = encodePythonReply(message, configuration.maxFrameBytes); }
      catch { reject(new PythonFailure('transport-unavailable')); return; }
      if (startup) admitted = true;
      try {
        socket.write(Buffer.concat([bytes, Buffer.from('\n')]), error => {
          if (error || retired || settled) {
            admitted = false;
            const failure = new PythonFailure('transport-unavailable');
            fail(failure); reject(failure); return;
          }
          resolve();
        });
      } catch {
        admitted = false;
        const failure = new PythonFailure('transport-unavailable');
        fail(failure); reject(failure);
      }
    });
    const message = (frame: any) => {
      if (retired || settled) return;
      if (!admitted) { fail(new PythonFailure('transport-unavailable')); return; }
      if (!frame || typeof frame !== 'object') { fail(new PythonFailure('transport-unavailable')); return; }
      if (frame.type === 'ready' && !ready) {
        ready = true;
        try { start!.onReady(); } catch (error) { fail(error); }
        return;
      }
      if (frame.type === 'exit' && !requesting) {
        if (!Number.isInteger(frame.exitCode) || frame.exitCode < 0 || frame.exitCode > 255) { fail(new PythonFailure('transport-unavailable')); return; }
        settled = true;
        resolveRun(frame.exitCode);
        return;
      }
      if (frame.type === 'error' && isPythonFailureCategory(frame.category)) { fail(new PythonFailure(frame.category)); return; }
      if (frame.type !== 'request' || requesting || !Number.isSafeInteger(frame.id) || frame.id !== requestId + 1
        || typeof frame.op !== 'string' || !Array.isArray(frame.args)) { fail(new PythonFailure('transport-unavailable')); return; }
      requestId = frame.id;
      requesting = true;
      const work = Promise.resolve().then(() => {
        if (!admitted || retired || settled) throw new PythonFailure('transport-unavailable');
        start!.signal.throwIfAborted();
        return start!.dispatch({ op: frame.op, args: frame.args });
      }).then(
        value => send({ id: frame.id, status: 1, value }),
        error => {
          let code: unknown;
          try { code = error?.code; } catch {}
          return send({ id: frame.id, status: 2, value: {
            code: isErrnoCode(code) || code === 'EPACKAGE' ? code : 'EIO',
            ...(code === 'EPACKAGE' ? { message: new PythonFailure('runtime-assets').message } : {}),
          } });
        },
      ).then(() => { requesting = false; }, error => { requesting = false; fail(error); });
      pending.add(work);
      void work.then(() => pending.delete(work));
    };

    const attach = (): Promise<void> => new Promise((resolve, reject) => {
      const control = http.request({ socketPath: configuration.socketPath, method: 'POST',
        path: '/v1.45/containers/' + encodeURIComponent(container!) + '/attach?stream=1&stdin=1&stdout=1&stderr=1',
        headers: { Connection: 'Upgrade', Upgrade: 'tcp' },
      });
      control.once('error', () => reject(new PythonFailure('transport-unavailable')));
      control.setTimeout(configuration.controlTimeoutMs, () => control.destroy(new DockerControlFailure()));
      control.once('response', response => { response.resume(); reject(new PythonFailure('transport-unavailable')); });
      control.once('upgrade', (_response, stream, head) => {
        socket = stream;
        stream.setTimeout?.(0);
        let buffered = Buffer.alloc(0);
        let line = Buffer.alloc(0);
        let stderrBytes = 0;
        const receive = (chunk: Buffer) => {
          if (retired || settled) return;
          if (buffered.length + chunk.length > configuration.maxFrameBytes + 65544) { fail(new PythonFailure('transport-unavailable')); return; }
          buffered = Buffer.concat([buffered, chunk]);
          while (buffered.length >= 8 && !settled && !retired) {
            const length = buffered.readUInt32BE(4);
            if (length > configuration.maxFrameBytes || ![1, 2].includes(buffered[0]!) || buffered[1] || buffered[2] || buffered[3]) { fail(new PythonFailure('transport-unavailable')); return; }
            if (buffered.length < 8 + length) return;
            const output = buffered.subarray(8, 8 + length);
            if (buffered[0] === 2) {
              stderrBytes += length;
              if (stderrBytes > configuration.maxFrameBytes) { fail(new PythonFailure('transport-unavailable')); return; }
            } else {
              if (line.length + output.length > configuration.maxFrameBytes) { fail(new PythonFailure('transport-unavailable')); return; }
              line = Buffer.concat([line, output]);
              let end: number;
              while ((end = line.indexOf(10)) >= 0 && !settled && !retired) {
                try { message(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(line.subarray(0, end)))); }
                catch { fail(new PythonFailure('transport-unavailable')); }
                line = Buffer.from(line.subarray(end + 1));
              }
            }
            buffered = Buffer.from(buffered.subarray(8 + length));
          }
        };
        stream.on('data', receive);
        stream.once('error', () => fail(new PythonFailure('transport-unavailable')));
        stream.once('end', () => fail(new PythonFailure(ready ? 'runtime' : 'startup')));
        stream.once('close', () => fail(new PythonFailure(ready ? 'runtime' : 'startup')));
        if (head.length) receive(head);
        resolve();
      });
      control.end();
    });

    return {
      run(invocation) {
        if (start || retired) return Promise.reject(new PythonFailure('executor-unavailable'));
        start = invocation;
        const running = new Promise<number>((resolve, reject) => { resolveRun = resolve; rejectRun = reject; });
        start.signal.addEventListener('abort', aborted, { once: true });
        timer = setTimeout(() => fail(new PythonFailure('deadline')), configuration.deadlineMs);
        initialization = (async () => {
          start!.signal.throwIfAborted();
          if (retired || settled) return;
          let creation;
          try {
            creation = await request('POST', '/containers/create?name=' + encodeURIComponent(name), {
              Image: configuration.image, User: '65534:65534', Env: [], WorkingDir: '/runtime',
              Entrypoint: ['/usr/local/bin/node'], Cmd: ['/runtime/python-executor.mjs'],
              AttachStdin: true, AttachStdout: true, AttachStderr: true, OpenStdin: true, StdinOnce: true, Tty: false,
              HostConfig: { NetworkMode: 'none', ReadonlyRootfs: true, CapDrop: ['ALL'], SecurityOpt: ['no-new-privileges'],
                Memory: configuration.memoryBytes, MemorySwap: configuration.memoryBytes,
                NanoCpus: Math.round(configuration.cpus * 1e9), PidsLimit: 64,
                Tmpfs: { '/tmp': 'rw,noexec,nosuid,nodev,mode=1777,size=' + configuration.temporaryBytes }, LogConfig: { Type: 'none' },
              },
            });
          } catch { creationUnconfirmed = true; throw new PythonFailure('startup'); }
          if (creation.status !== 201 || typeof creation.value?.Id !== 'string' || !creation.value.Id) {
            creationUnconfirmed = creation.status < 400 || creation.status >= 500;
            throw new PythonFailure('startup');
          }
          container = creation.value.Id;
          if (retired || settled) return;
          await attach();
          if (retired || settled) return;
          const started = await request('POST', '/containers/' + encodeURIComponent(container!) + '/start');
          if (started.status !== 204 && started.status !== 304) throw new PythonFailure('startup');
          if (retired || settled) return;
          await send({ type: 'start', invocation: start!.invocation, runtimeMount: start!.runtimeMount,
            maxTransferBytes: start!.maxTransferBytes, maxFrameBytes: configuration.maxFrameBytes,
            ...(start!.packages ? { packages: start!.packages } : {}), installOnly: !!start!.installOnly,
          }, true);
        })().catch(error => fail(error instanceof PythonFailure || start!.signal.aborted ? error : new PythonFailure('startup')));
        return running;
      },
      terminate() {
        retired = true;
        if (timer) clearTimeout(timer);
        start?.signal.removeEventListener('abort', aborted);
        if (start && !settled) fail(new PythonFailure('runtime'));
        retirement ??= (async () => {
          socket?.destroy();
          await initialization;
          socket?.destroy();
          let failure: PythonFailure | undefined;
          if (container || creationUnconfirmed) {
            try {
              const removed = await request('DELETE', '/containers/' + encodeURIComponent(container ?? name) + '?force=1&v=1');
              if (![204, 404].includes(removed.status) || creationUnconfirmed) throw new PythonFailure('cleanup');
            } catch { failure = new PythonFailure('cleanup'); }
          }
          await Promise.allSettled([...pending]);
          if (failure) throw failure;
        })();
        return retirement;
      },
    };
  } });
}
