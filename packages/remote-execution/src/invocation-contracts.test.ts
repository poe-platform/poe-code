import { expect, it, vi } from 'vitest';
import { Shell, MemoryFileSystem } from '@poe-platform/safe-bash';
import { createProcessSignalChannel } from 'safe-bash-contracts/process';
import { encodeFrame, decodeFrames } from './binary.js';
import { executeRemoteProcess, type ProcessConnection } from './process.js';

function setup() {
  const fs = new MemoryFileSystem();
  const shell = new Shell({ fs });
  shell.register({ name: 'say', async execute({ args, stdout }) {
    await stdout.write(new TextEncoder().encode(`${args.join(' ')}\n`));
    return { exitCode: 0 };
  } });
  return { shell, fs };
}

function output(channelId: number, text: string) {
  const payload = new TextEncoder().encode(text);
  const limits = { maxFrameBytes: 64, maxControlBytes: 64, channels: [channelId] };
  return new ReadableStream<Uint8Array>({ start(controller) {
    controller.enqueue(encodeFrame({ kind: 'data', channelId, sequence: 1n, offset: 0n, correlationId: 0n, payload }, limits));
    controller.enqueue(encodeFrame({ kind: 'end', channelId, sequence: 2n, offset: BigInt(payload.length), correlationId: 0n, payload: new Uint8Array() }, limits));
    controller.close();
  } });
}
function connection(): ProcessConnection {
  return { stdinKind: 'pipe', maxFrameBytes: 64,
    outputs: new Map([[2, output(2, '')], [3, output(3, '')]]),
    outcome: Promise.resolve({ kind: 'exited', exitCode: 0 }),
    async send(_channel, _frame, offset) { return offset; }, async ack() {}, async closeOutput() {}, async close() {},
  };
}

it('validates and forwards one snapshot of a borrowed process signal event', async () => {
  const { shell } = setup();
  const remote = connection();
  let finish!: () => void;
  remote.outcome = new Promise(resolve => { finish = () => resolve({ kind: 'exited', exitCode: 42 }); });
  remote.signal = vi.fn(async () => { finish(); });
  const reads = { name: 0, number: 0, target: 0, sequence: 0 };
  let accepted!: Promise<{ sequence: bigint }>;
  const signals = { subscribe(accept: (event: { name: string; number: number; target: 'process-group'; sequence: bigint }) => Promise<{ sequence: bigint }>) {
    accepted = accept({
      get name() { return ++reads.name === 1 ? 'SIGINT' : 'SIGTERM'; },
      get number() { return ++reads.number === 1 ? 2 : 15; },
      get target(): 'process-group' { reads.target++; return 'process-group'; },
      get sequence() { return BigInt(++reads.sequence); },
    });
    return async () => { await accepted; };
  } };
  shell.register({ name: 'remote', execute(context) { return executeRemoteProcess(context, async () => remote); } });
  try {
    expect((await shell.exec('remote', { processSignals: signals })).exitCode).toBe(42);
    expect(await accepted).toEqual({ sequence: 1n });
    expect(reads).toEqual({ name: 1, number: 1, target: 1, sequence: 1 });
    expect(remote.signal).toHaveBeenCalledWith('SIGINT', 2, 'process-group');
  } finally { await shell.dispose(); }
});

for (const descriptor of [false, true]) {
it(`returns accepted retained-file credit before cancellation retires ${descriptor ? 'fd 3' : 'stdout'}`, async () => {
  const { shell, fs } = setup();
  const controller = new AbortController();
  const cause = new Error('cancel retained canonical write');
  let entered!: () => void; const ready = new Promise<void>(resolve => { entered = resolve; });
  let release!: () => void; const pending = new Promise<void>(resolve => { release = resolve; });
  const events: string[] = [];
  let closes = 0;
  Object.defineProperty(fs, 'open', { value: async () => {
    return { capabilities: { positionedRead: false, positionedWrite: false, truncate: false, synchronization: 'volatile' },
      async stat() { return { type: 'file', size: 0 }; },
      async read() { throw new Error('Write-only descriptor'); },
      async truncate() { throw new Error('Truncation is performed at acquisition'); },
      async sync() {},
      async write(bytes: Uint8Array) {
        entered(); await pending;
        await fs.writeFile('/accepted', bytes);
        events.push('canonical'); return bytes.length;
      },
      async close() { closes++; },
    };
  } });
  const remote = connection();
  const channel = descriptor ? 4 : 2;
  remote.outputs.set(channel, output(channel, 'accepted'));
  remote.ack = async id => { if (id === channel) events.push('ack'); };
  remote.close = async () => { events.push('close'); };
  shell.register({ name: 'remote', execute(context) { return executeRemoteProcess(context, async () => remote); } });
  const execution = shell.exec(descriptor ? 'remote 3>/media' : 'remote >/media', { signal: controller.signal });
  const rejected = expect(execution).rejects.toBe(cause);
  try {
    await ready; controller.abort(cause);
    await new Promise<void>(resolve => setImmediate(resolve));
    expect(events).toEqual([]);
    release(); await rejected;
    expect(events).toEqual(['canonical', 'ack', 'close']);
    expect(new TextDecoder().decode(await fs.readFile('/accepted'))).toBe('accepted');
    expect(closes).toBe(1);
    expect((await shell.exec('say subsequent')).stdout).toBe('subsequent\n');
  } finally { release(); await shell.dispose(); }
});
}

it('maps progress fd 3 and two inherited inputs through actual shell admission, preserving append and dup/close', async () => {
  const { shell, fs } = setup();
  await fs.writeFile('/a', new TextEncoder().encode('alpha'));
  await fs.writeFile('/b', new TextEncoder().encode('beta'));
  await fs.writeFile('/progress', new TextEncoder().encode('before:'));
  const input = new Map<number, string>();
  let finish!: () => void;
  const remote = connection();
  remote.outputs = new Map([[2, output(2, 'stdout')], [3, output(3, 'stderr')], [4, output(4, 'progress=end')]]);
  remote.inputChannels = [1, 5, 6];
  remote.outcome = new Promise(resolve => { finish = () => resolve({ kind: 'exited', exitCode: 0 }); });
  const ended = new Set<number>();
  remote.send = async (channel, wire, offset) => {
    const source = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(wire); controller.close(); } });
    for await (const frame of decodeFrames(source, { maxFrameBytes: 64, maxControlBytes: 64, channels: [channel], firstSequence: new DataView(wire.buffer, wire.byteOffset, wire.byteLength).getBigUint64(16), offsets: new Map([[channel, new DataView(wire.buffer, wire.byteOffset, wire.byteLength).getBigUint64(24)]]) })) {
      if (frame.kind === 'data') input.set(channel, (input.get(channel) ?? '') + new TextDecoder().decode(frame.payload));
      else ended.add(channel);
    }
    if (ended.size === 3) finish();
    return offset;
  };
  shell.register({ name: 'remote', execute(context) { return executeRemoteProcess(context, async () => remote); } });
  const result = await shell.exec('remote 3>>/progress 4</a 5</b 6<&4 6<&-');
  expect(result.exitCode, result.stderr).toBe(0);
  expect(result.stdout).toBe('stdout'); expect(result.stderr).toBe('stderr');
  expect(input).toEqual(new Map([[5, 'alpha'], [6, 'beta']]));
  expect(new TextDecoder().decode(await fs.readFile('/progress'))).toBe('before:progress=end');
  await shell.dispose();
});

it('forwards ordered SIGINT independently of cancellation and retains explicit handler exits', async () => {
  const { shell } = setup();
  const channel = createProcessSignalChannel();
  const remote = connection();
  let finish!: () => void;
  remote.outcome = new Promise(resolve => { finish = () => resolve({ kind: 'exited', exitCode: 42 }); });
  const signals: string[] = [];
  remote.signal = vi.fn(async (name: string) => { signals.push(name); if (signals.length === 2) finish(); });
  shell.register({ name: 'remote', execute(context) { return executeRemoteProcess(context, async () => remote); } });
  let ready!: () => void;
  const subscribed = new Promise<void>(resolve => { ready = resolve; });
  remote.send = async (_channel, _wire, offset) => { ready(); return offset; };
  const execution = shell.exec('remote', { processSignals: channel });
  await subscribed;
  const first = channel.send({ name: 'SIGINT', number: 2, target: 'process-group' });
  const second = channel.send({ name: 'SIGTERM', number: 15, target: 'process-group' });
  await Promise.all([first, second]);
  expect((await execution).exitCode).toBe(42);
  expect(signals).toEqual(['SIGINT', 'SIGTERM']);
  await shell.dispose();
});

it('projects signal-only termination with the caller policy', async () => {
  const { shell } = setup();
  const remote = connection();
  remote.outcome = Promise.resolve({ kind: 'signaled', signal: 'SIGINT', signalNumber: 2 });
  shell.register({ name: 'remote', execute(context) { return executeRemoteProcess(context, async () => remote, (_name, number) => 128 + number); } });
  expect((await shell.exec('remote')).exitCode).toBe(130);
  await shell.dispose();
});

it('notifies native fd 3 closure while stderr still drains', async () => {
  const { shell } = setup();
  const consumer = new AbortController();
  const cause = Object.assign(new Error('progress pipe closed'), { code: 'EPIPE' });
  consumer.abort(cause);
  const remote = connection();
  remote.outputs = new Map([[2, output(2, '')], [3, output(3, 'diagnostic')], [4, new ReadableStream<Uint8Array>()]]);
  remote.closeOutput = vi.fn(async () => {});
  shell.register({ name: 'remote', execute(context) { return executeRemoteProcess(context, async () => remote); } });
  const sink = { async write() {}, ownedOutput: { consumerClosed: consumer.signal, async write() { throw cause; } } };
  const result = await shell.exec('remote 3>&1', { stdout: sink });
  expect(result.exitCode).toBe(0);
  expect(result.stderr).toContain('diagnostic');
  expect(remote.closeOutput).toHaveBeenCalledWith(4, cause);
  await shell.dispose();
});

it('cancellation disposes the invocation without sending SIGINT and preserves the caller cause', async () => {
  const { shell } = setup();
  const channel = createProcessSignalChannel();
  const controller = new AbortController();
  const cause = new Error('dispose remote job');
  const remote = connection();
  remote.outcome = new Promise(() => {});
  remote.signal = vi.fn(); remote.close = vi.fn(async () => {});
  let ready!: () => void;
  const entered = new Promise<void>(resolve => { ready = resolve; });
  remote.send = async (_channel, _wire, offset) => { ready(); return offset; };
  shell.register({ name: 'remote', execute(context) { return executeRemoteProcess(context, async () => remote); } });
  const execution = shell.exec('remote', { processSignals: channel, signal: controller.signal });
  const rejected = expect(execution).rejects.toBe(cause);
  await entered; controller.abort(cause);
  await rejected;
  expect(remote.signal).not.toHaveBeenCalled();
  expect(remote.close).toHaveBeenCalledTimes(1);
  await shell.dispose();
});

for (const descriptor of [false, true]) {
for (const accepted of [false, true]) {
it(`preserves ${accepted ? 'accepted' : 'failed'} owned delivery through shell ${descriptor ? 'descriptor' : 'stdout'} wrappers after cancellation`, async () => {
  const { shell } = setup();
  const controller = new AbortController();
  const cause = new Error('cancel while canonical output is pending');
  let entered!: () => void;
  const ready = new Promise<void>(resolve => { entered = resolve; });
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  const events: string[] = [];
  let lateWrite!: () => Promise<void>;
  const remote = connection();
  const outputChannel = descriptor ? 4 : 2;
  remote.outputs.set(outputChannel, output(outputChannel, 'accepted'));
  remote.ack = async channel => { if (channel === outputChannel) events.push('ack'); };
  remote.close = async () => { events.push('close'); };
  shell.register({ name: 'remote', execute(context) {
    lateWrite = () => context.stdout.ownedOutput!.write(new Uint8Array([1]));
    return executeRemoteProcess(context, async () => remote);
  } });
  const execution = shell.exec(descriptor ? 'remote 3>&1' : 'remote', { signal: controller.signal, stdout: {
    async write() { throw new Error('Owned destination must be used'); },
    ownedOutput: { consumerClosed: new AbortController().signal, async write(chunk) {
      if (!chunk.length) return;
      entered(); await pending;
      events.push(accepted ? 'canonical' : 'rejected');
      if (!accepted) throw new Error('Canonical sink rejected delivery');
    } },
  } });
  const rejected = expect(execution).rejects.toBe(cause);
  try {
    await ready;
    controller.abort(cause);
    await new Promise<void>(resolve => setImmediate(resolve));
    expect(events).toEqual([]);
    release();
    await rejected;
    const expected = accepted ? ['canonical', 'ack', 'close'] : ['rejected', 'close'];
    expect(events).toEqual(expected);
    await expect(lateWrite()).rejects.toBe(cause);
    expect(events).toEqual(expected);
  } finally { release(); await shell.dispose(); }
});
}
}
