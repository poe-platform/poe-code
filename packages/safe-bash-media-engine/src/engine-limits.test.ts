import { expect, it, vi } from 'vitest';
import { createJobBinding } from '@poe-code/remote-execution';
import { createMediaEngine } from './engine.js';

const invocation = { sessionId: 's', epoch: 'e', buildId: 'b', sourceAuthorityId: 'a', bindingId: 'g',
  materializationId: 'm', manifestId: 'f', manifestRevision: 'r', directoryRevision: 'd' };
const request = () => ({ command: 'ffmpeg', args: [Uint8Array.of(97), new Uint8Array()], cwd: '/work',
  env: {}, fs: { objects: { open: vi.fn() } }, signal: new AbortController().signal,
  stdin: { async *[Symbol.asyncIterator]() {} }, stdout: { async write() {} }, stderr: { async write() {} } });

it.each([undefined, Infinity])('executes arguments and cwd beyond 1 MiB through a real job binding with limits %s', async bound => {
  const input = request();
  input.args = [new Uint8Array(1048577).fill(97), new Uint8Array()];
  input.cwd = '/' + 'a'.repeat(1048576);
  const run = vi.fn(async () => ({ exitCode: 0 }));
  const limits = { maxArgvBytes: bound, maxArgumentBytes: bound, maxPathBytes: bound };
  const engine = createMediaEngine({ ...limits, bind: async owned => ({ invocation,
    job: createJobBinding({ ...invocation, ...limits, fs: owned.fs, credential: {}, maxCallbacks: 1, maxHandles: 1,
      prepare: async description => ({ ...description, state: 'ready', entries: [],
        readiness: [{ kind: 'required', identity: 'cwd', state: 'complete' }] }), run }),
  }) });
  await expect(engine.execute(input)).resolves.toEqual({ exitCode: 0 });
  expect(run).toHaveBeenCalledOnce();
  expect(input.fs.objects.open).not.toHaveBeenCalled();
});

it('counts each empty argument terminator at an explicit argv boundary', async () => {
  const execute = vi.fn(async () => ({ exitCode: 0 }));
  const bind = vi.fn(async () => ({ invocation, job: { execute } }));
  const engine = createMediaEngine({ bind, maxArgvBytes: 3 });
  await expect(engine.execute(request())).resolves.toEqual({ exitCode: 0 });
  const input = request(); input.args.push(new Uint8Array());
  await expect(engine.execute(input)).rejects.toThrow('Native argv limit');
  expect(bind).toHaveBeenCalledOnce();
});

it.each(['maxArgvBytes', 'maxArgumentBytes', 'maxPathBytes'] as const)('rejects invalid engine %s before binding', key => {
  const bind = vi.fn();
  for (const value of [0, -1, -Infinity, NaN, 1.5, Number.MAX_SAFE_INTEGER + 1, null]) {
    expect(() => createMediaEngine({ bind, [key]: value })).toThrow('Invalid native process bound');
  }
  expect(bind).not.toHaveBeenCalled();
});
