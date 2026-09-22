import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import { createNativeLauncher, nativeEnvironment } from './native-process.js';
function fakeChild() {
  const child = new EventEmitter() as EventEmitter & { pid: number; stdio: PassThrough[] };
  child.pid = 123; child.stdio = [new PassThrough(), new PassThrough(), new PassThrough(), new PassThrough()]; return child;
}
const spec = { executable: '/tools/tool', args: [[], [36, 40, 105, 100, 41], [97, 32, 98]], cwd: '/work', env: { VALUE: 'x y' }, outputChannels: [2, 3], inputChannels: [1], maxFrameBytes: 8 };
it.each([null, undefined, 'secret', ['secret'], new Map([['VALUE', 'secret']])])('refuses a non-record native environment before launch (%j)', env => {
  const spawn = vi.fn();
  const launcher = createNativeLauncher({ spawn: spawn as never });
  expect(() => launcher.launch({ ...spec, env: env as never }, { async output() {}, async end() {} })).toThrow('Invalid native environment');
  expect(spawn).not.toHaveBeenCalled();
});
it('admits an exact null-prototype environment including empty values without retaining the caller map', () => {
  const env = Object.assign(Object.create(null), { VALUE: '', PATH: '/explicit/bin' });
  const admitted = nativeEnvironment(env);
  env.VALUE = 'changed';
  expect(admitted).toEqual({ VALUE: '', PATH: '/explicit/bin' });
});
it('refuses Node permission mode which injects permission flags into the native environment', () => {
  const original = Object.getOwnPropertyDescriptor(process, 'permission');
  Object.defineProperty(process, 'permission', { value: { has: () => true }, configurable: true });
  try { expect(() => createNativeLauncher()).toThrow('permission mode'); }
  finally {
    if (original) Object.defineProperty(process, 'permission', original);
    else Reflect.deleteProperty(process, 'permission');
  }
});
it('prevents Node spawn from inheriting prototype environment entries or ambient coverage paths', async () => {
  const child = fakeChild();
  let admitted: Record<string, string | undefined> = {};
  const spawn = vi.fn((_executable, _args, options) => {
    // Node intentionally enumerates inherited env keys and propagates coverage
    // unless the supplied environment owns that key (child_process source).
    const env = options.env;
    if (!Object.hasOwn(env, 'NODE_V8_COVERAGE')) env.NODE_V8_COVERAGE = '/server/private/coverage';
    admitted = {};
    for (const key in env) admitted[key] = env[key];
    return child;
  });
  Object.defineProperty(Object.prototype, 'REMOTE_EXECUTION_AMBIENT', { value: 'server-secret', writable: true, enumerable: true, configurable: true });
  let run;
  try {
    run = createNativeLauncher({ spawn: spawn as never }).launch(spec, { async output() {}, async end() {} });
  } finally { delete (Object.prototype as Record<string, unknown>).REMOTE_EXECUTION_AMBIENT; }
  child.stdio[1].end(); child.stdio[2].end(); child.emit('exit', 0, null); child.emit('close', 0, null);
  await run.settled;
  expect(await run.exit).toEqual({ kind: 'exited', exitCode: 0 });
  expect(admitted).toEqual({ VALUE: 'x y' });
});
it.each(['', '/caller/coverage'])('preserves explicitly supplied coverage configuration %j', async coverage => {
  const child = fakeChild();
  const spawn = vi.fn(() => child);
  const run = createNativeLauncher({ spawn: spawn as never }).launch({ ...spec, env: { NODE_V8_COVERAGE: coverage } }, { async output() {}, async end() {} });
  expect(Object.entries((spawn.mock.calls[0] as unknown as [string, string[], { env: Record<string, string> }])[2].env)).toEqual([['NODE_V8_COVERAGE', coverage]]);
  child.stdio[1].end(); child.stdio[2].end(); child.emit('exit', 0, null); child.emit('close', 0, null);
  await run.settled;
});
it('reports broken pipe after admitted stdin EOF while stderr and native status remain available', async () => {
  const child = fakeChild();
  const output = vi.fn(async () => {});
  const run = createNativeLauncher({ spawn: (() => child) as never }).launch(spec, { output, async end() {} });
  await run.end(1);
  const write = vi.spyOn(child.stdio[0], 'write');
  const lateWrite = await run.write(1, new Uint8Array([9])).then(() => undefined, cause => cause);
  child.stdio[1].end(); child.stdio[2].end(new Uint8Array([7]));
  child.emit('exit', 42, null); child.emit('close', 42, null);
  await run.settled;
  expect(lateWrite).toMatchObject({ code: 'EPIPE' });
  expect(write).not.toHaveBeenCalled();
  expect(output).toHaveBeenCalledWith(3, new Uint8Array([7]));
  expect(await run.exit).toEqual({ kind: 'exited', exitCode: 42 });
});
it('preserves an explicitly admitted Node argv budget above the byte-helper limit',async()=>{
 const child=fakeChild();const spawn=vi.fn(()=>child);
 const input={...spec,args:[new Array<number>(1048577).fill(65)],maxArgvBytes:2097152};
 const run=createNativeLauncher({spawn:spawn as never}).launch(input,{async output(){},async end(){}});
 expect(spawn.mock.calls.length).toBe(1);
 child.stdio[1].end();child.stdio[2].end();child.emit('exit',0,null);child.emit('close',0,null);await run.settled;
});
it('admits native input by its actual byte span before copying or writing', async () => {
  const child = fakeChild();
  const write = vi.spyOn(child.stdio[0], 'write');
  const run = createNativeLauncher({ spawn: (() => child) as never }).launch(spec, { async output() {}, async end() {} });
  const oversized = new Uint8Array(9);
  Object.defineProperty(oversized, 'length', { value: 1 });
  await expect(run.write(1, oversized)).rejects.toThrow('Input frame length exceeds admission');
  expect(write).not.toHaveBeenCalled();
  child.stdio[1].end(); child.stdio[2].end(); child.emit('exit', 0, null); child.emit('close', 0, null);
  await run.settled;
});
it.each([[], { length: 1, 0: 9 }, new DataView(new ArrayBuffer(1))])('refuses non-byte native input without invoking conversion hooks', async bytes => {
  const child = fakeChild();
  const write = vi.spyOn(child.stdio[0], 'write');
  const run = createNativeLauncher({ spawn: (() => child) as never }).launch(spec, { async output() {}, async end() {} });
  await expect(run.write(1, bytes as Uint8Array)).rejects.toThrow('Native input bytes required');
  expect(write).not.toHaveBeenCalled();
  child.stdio[1].end(); child.stdio[2].end(); child.emit('exit', 0, null); child.emit('close', 0, null);
  await run.settled;
});
it('preserves delivery and EOF failures on every lane separately from native exit', async () => {
  const child = fakeChild();
  const delivery = new Error('stdout delivery failed');
  const stdoutEOF = new Error('stdout EOF failed');
  const stderrEOF = new Error('stderr EOF failed');
  const run = createNativeLauncher({ spawn: (() => child) as never }).launch(spec, {
    async output() { throw delivery; },
    async end(channel) { throw channel === 2 ? stdoutEOF : stderrEOF; },
  });
  const observed = run.settled.catch(error => error);
  child.stdio[1].end(new Uint8Array([7])); child.stdio[2].end();
  child.emit('exit', 23, null); child.emit('close', 23, null);
  expect(await run.exit).toEqual({ kind: 'exited', exitCode: 23 });
  const failure = await observed;
  expect(failure).toBeInstanceOf(AggregateError);
  expect(failure.errors).toHaveLength(2);
  expect(failure.errors[0]).toMatchObject({ errors: [delivery, stdoutEOF] });
  expect(failure.errors[1]).toBe(stderrEOF);
});
it('preserves all output EOF failures after a synchronous spawn error', async () => {
  const failures = [new Error('stdout EOF'), new Error('stderr EOF')];
  const run = createNativeLauncher({ spawn() { throw Object.assign(new Error('spawn'), { code: 'ENOENT' }); } }).launch(spec, {
    async output() {}, async end(channel) { throw failures[channel - 2]; },
  });
  await expect(run.settled).rejects.toMatchObject({ errors: failures });
  expect(await run.exit).toMatchObject({ kind: 'spawnError', code: 'ENOENT' });
});
it.each([undefined, 'EPIPE'])('retains an admitted delivery failure (%s) when output retirement races its receipt', async code => {
  const child = fakeChild(); const failure = Object.assign(new Error('accepted frame failed'), { code });
  let reject!: (cause: unknown) => void;
  let admitted!: () => void;
  const ready = new Promise<void>(resolve => { admitted = resolve; });
  const receipt = new Promise<void>((_resolve, fail) => { reject = fail; });
  const run = createNativeLauncher({ spawn: (() => child) as never }).launch(spec, {
    output() { admitted(); return receipt; }, async end() {},
  });
  const observed = run.settled.catch(error => error);
  child.stdio[1].write(new Uint8Array([7])); await ready;
  run.closeOutput!(2); reject(failure);
  child.stdio[2].end(); child.emit('exit', 0, null); child.emit('close', 0, null);
  expect(await observed).toBe(failure);
});
it.each(['write', 'end'] as const)('drains admitted %s receipts before I/O settlement and refuses writes after native close', async operation => {
  const child = fakeChild();
  let receipt!: () => void;
  vi.spyOn(child.stdio[0], operation).mockImplementation((...args: unknown[]) => {
    receipt = args.at(-1) as () => void;
    return (operation === 'write' ? true : child.stdio[0]) as never;
  });
  const run = createNativeLauncher({ spawn: (() => child) as never }).launch(spec, { async output() {}, async end() {} });
  const writing = operation === 'write' ? run.write(1, new Uint8Array([9])) : run.end(1);
  child.stdio[1].end(); child.stdio[2].end(); child.emit('exit', 7, null); child.emit('close', 7, null);
  expect(await run.exit).toEqual({ kind: 'exited', exitCode: 7 });
  let settled = false;
  void run.settled.then(() => { settled = true; });
  await new Promise<void>(resolve => setImmediate(resolve));
  const beforeReceipt = settled;
  const admittedReceipt = receipt;
  const lateWrite = run.write(1, new Uint8Array([8])).then(() => undefined, error => error);
  admittedReceipt(); receipt(); await writing; await run.settled;
  expect(beforeReceipt).toBe(false);
  expect(await lateWrite).toMatchObject({ code: 'EPIPE' });
});
describe('server native process API', () => {
  it('rejects sparse descriptor carriers before spawning a native process', () => {
    const spawn = vi.fn();
    const launcher = createNativeLauncher({ spawn: spawn as never });
    for (const field of ['inputChannels', 'outputChannels', 'stdio'] as const) {
      const entries = field === 'stdio' ? ['pipe', 'pipe', 'pipe', 'pipe'] : [4];
      delete entries[field === 'stdio' ? 3 : 0];
      expect(() => launcher.launch({ ...spec, [field]: entries }, { async output() {}, async end() {} })).toThrow('Invalid native descriptors');
    }
    expect(spawn).not.toHaveBeenCalled();
  });
  it('uses each admitted descriptor entry once through native launch and input authority', async () => {
    const child = fakeChild(); const spawn = vi.fn(() => child);
    let reads = 0;
    const inputChannels = [1];
    Object.defineProperty(inputChannels, 0, { get() { return ++reads === 1 ? 1 : 4; } });
    const run = createNativeLauncher({ spawn: spawn as never }).launch({ ...spec, inputChannels }, { async output() {}, async end() {} });
    const denied = await run.write(4, new Uint8Array([9])).then(() => undefined, error => error);
    child.stdio[1].end(); child.stdio[2].end(); child.emit('exit', 0, null); child.emit('close', 0, null);
    await run.settled;
    expect(denied).toBeInstanceOf(TypeError);
    expect(reads).toBe(1);
    expect(spawn).toHaveBeenCalledWith(spec.executable, expect.anything(), expect.objectContaining({ stdio: ['pipe', 'pipe', 'pipe'] }));
  });
  it('launches the exact executable, cwd and environment whose text was admitted', async () => {
    const child = fakeChild(); const spawn = vi.fn(() => child);
    const reads = { executable: 0, cwd: 0, env: 0, value: 0 };
    const env = {};
    Object.defineProperty(env, 'VALUE', { enumerable: true, get() { return ++reads.value === 1 ? 'admitted' : 'changed'; } });
    const input = { ...spec,
      get executable() { return ++reads.executable === 1 ? '/tools/tool' : '/tools/other'; },
      get cwd() { return ++reads.cwd === 1 ? '/work' : '/other'; },
      get env() { reads.env++; return env; },
    };
    const run = createNativeLauncher({ spawn: spawn as never }).launch(input, { async output() {}, async end() {} });
    child.stdio[1].end(); child.stdio[2].end(); child.emit('exit', 0, null); child.emit('close', 0, null);
    await run.settled;
    expect(spawn).toHaveBeenCalledWith('/tools/tool', expect.anything(), expect.objectContaining({ cwd: '/work', env: { VALUE: 'admitted' } }));
    expect(reads).toEqual({ executable: 1, cwd: 1, env: 1, value: 1 });
  });
  it('drains every output EOF after synchronous spawn failure before settling', async () => {
    const cause = new Error('stderr EOF receipt failed');
    let release!: () => void;
    const pending = new Promise<void>(resolve => { release = resolve; });
    const end = vi.fn(async (channel: number) => {
      if (channel === 2) throw cause;
      await pending;
    });
    const run = createNativeLauncher({ spawn() { throw Object.assign(new Error('spawn'), { code: 'ENOENT' }); } }).launch(spec, { async output() {}, end });
    let settled = false;
    const observed = run.settled.then(() => { settled = true; }, error => { settled = true; return error; });
    await new Promise<void>(resolve => setImmediate(resolve));
    const settledBeforeEOF = settled;
    release();
    expect(await observed).toBe(cause);
    expect(settledBeforeEOF).toBe(false);
    expect(end.mock.calls).toEqual([[2], [3]]);
    expect(await run.exit).toMatchObject({ kind: 'spawnError', code: 'ENOENT' });
  });
  it('observes synchronous EOF callback failures without abandoning sibling output', async () => {
    const cause = new Error('stdout EOF callback failed');
    const end = vi.fn((channel: number): Promise<void> => {
      if (channel === 2) throw cause;
      return Promise.resolve();
    });
    const run = createNativeLauncher({ spawn() { throw new Error('spawn'); } }).launch(spec, { async output() {}, end });
    await expect(run.settled).rejects.toBe(cause);
    expect(end.mock.calls).toEqual([[2], [3]]);
    expect(await run.exit).toMatchObject({ kind: 'spawnError' });
  });
  it('stops admitting split stdout frames after closure while draining accepted writes and stderr', async () => {
    const child = fakeChild();
    let release!: () => void;
    const receipt = new Promise<void>(resolve => { release = resolve; });
    const output = vi.fn(async (channel: number) => { if (channel === 2) await receipt; });
    const end = vi.fn(async () => {});
    const run = createNativeLauncher({ spawn: (() => child) as never }).launch(
      { ...spec, maxFrameBytes: 2 }, { output, end },
    );
    child.stdio[1].write(new Uint8Array([0, 255, 1, 2, 3, 4]));
    await vi.waitFor(() => expect(output).toHaveBeenCalledWith(2, new Uint8Array([0, 255])), { interval: 1 });
    run.closeOutput!(2);
    child.stdio[2].end(new Uint8Array([9]));
    child.emit('exit', 42, null); child.emit('close', 42, null);
    let settled = false;
    void run.settled.then(() => { settled = true; });
    await new Promise<void>(resolve => setImmediate(resolve));
    expect(settled).toBe(false);
    release(); await run.settled;
    expect(output.mock.calls.filter(([channel]) => channel === 2)).toHaveLength(1);
    expect(output).toHaveBeenCalledWith(3, new Uint8Array([9]));
    expect(end).toHaveBeenCalledWith(2); expect(end).toHaveBeenCalledWith(3);
    expect(await run.exit).toEqual({ kind: 'exited', exitCode: 42 });
  });
  it('admits the complete argv size including terminators before reading any octets', () => {
    const spawn = vi.fn();
    const launcher = createNativeLauncher({ spawn: spawn as never });
    const octets = [97];
    Object.defineProperty(octets, 0, { get() { throw new Error('Unadmitted octet accessed'); } });
    for (const args of [[octets, [98, 99]], new Array(6)]) {
      expect(() => launcher.launch({ ...spec, args, maxArgvBytes: 4 }, { async output() {}, async end() {} })).toThrow('Native argv byte bound');
    }
    expect(spawn).not.toHaveBeenCalled();
  });
  it('counts empty argv tokens and rejects invalid argv budgets before spawn', async () => {
    const child = fakeChild(); const spawn = vi.fn(() => child);
    const launcher = createNativeLauncher({ spawn: spawn as never });
    for (const maxArgvBytes of [-1, 1.5, Infinity]) {
      expect(() => launcher.launch({ ...spec, args: [], maxArgvBytes }, { async output() {}, async end() {} })).toThrow('Invalid native argv bound');
    }
    expect(() => launcher.launch({ ...spec, args: [[], []], maxArgvBytes: 1 }, { async output() {}, async end() {} })).toThrow('Native argv byte bound');
    expect(spawn).not.toHaveBeenCalled();
    const run = launcher.launch({ ...spec, args: [[], []], maxArgvBytes: 2 }, { async output() {}, async end() {} });
    expect(spawn.mock.calls[0][1]).toEqual(['', '']);
    child.stdio[1].end(); child.stdio[2].end(); child.emit('exit', 0, null); child.emit('close', 0, null); await run.settled;
  });
  it('rejects oversized channel and stdio lists before reading or copying their entries', () => {
    const spawn = vi.fn();
    const launcher = createNativeLauncher({ spawn: spawn as never });
    for (const field of ['inputChannels', 'outputChannels', 'stdio'] as const) {
      const entries = new Array(field === 'stdio' ? 1025 : 65);
      Object.defineProperty(entries, 0, { get() { throw new Error('Unadmitted descriptor entry accessed'); } });
      expect(() => launcher.launch({ ...spec, [field]: entries }, { async output() {}, async end() {} })).toThrow('Invalid native descriptors');
    }
    expect(spawn).not.toHaveBeenCalled();
  });
  it('retains admitted frame limits and channel authority after launch', async () => {
    const child = fakeChild(); const output = vi.fn(async () => {});
    const admitted = { ...spec, inputChannels: [1], outputChannels: [2, 3], maxFrameBytes: 2 };
    const run = createNativeLauncher({ spawn: (() => child) as never, killGroup: vi.fn() }).launch(admitted, { output, async end() {} });
    admitted.maxFrameBytes = 8; admitted.inputChannels.push(4); admitted.outputChannels.push(4);
    const write = await run.write(4, new Uint8Array([9])).then(() => undefined, error => error);
    const oversized = await run.write(1, new Uint8Array([1, 2, 3])).then(() => undefined, error => error);
    child.stdio[1].end(new Uint8Array([1, 2, 3, 4, 5])); child.stdio[2].end();
    child.emit('exit', 0, null); child.emit('close', 0, null); await run.settled;
    expect(write).toBeInstanceOf(TypeError); expect(oversized).toBeInstanceOf(TypeError);
    expect(output.mock.calls).toEqual([[2, new Uint8Array([1, 2])], [2, new Uint8Array([3, 4])], [2, new Uint8Array([5])]]);
    expect(() => run.closeOutput!(4)).toThrow('not admitted');
  });
  it('refuses excessive native stream acquisition before spawn',()=>{
    const spawn=vi.fn(()=>fakeChild());const launcher=createNativeLauncher({spawn:spawn as never,killGroup:vi.fn()});
    const inputs=[1,...Array.from({length:64},(_,index)=>index+4)];
    expect(()=>launcher.launch({...spec,inputChannels:inputs},{async output(){},async end(){}})).toThrow('descriptors');expect(spawn).not.toHaveBeenCalled();
  });
  it('passes literal ordered arguments, empty tokens, cwd and env using shell:false', async () => {
    const child = fakeChild(); const spawn = vi.fn(() => child);
    const launcher = createNativeLauncher({ spawn: spawn as never, killGroup: vi.fn() });
    const run = launcher.launch(spec, { async output() {}, async end() {} });
    expect(spawn).toHaveBeenCalledWith('/tools/tool', ['', '$(id)', 'a b'], expect.objectContaining({ cwd: '/work', env: { VALUE: 'x y' }, shell: false, detached: true }));
    child.stdio[1].end(); child.stdio[2].end(); child.emit('exit', 1, null); child.emit('close', 1, null);
    expect(await run.exit).toEqual({ kind: 'exited', exitCode: 1 }); await run.settled;
  });
  it('refuses NUL and unrepresentable UTF-8 before spawn rather than replacing tokens', () => {
    const spawn = vi.fn(); const launcher = createNativeLauncher({ spawn: spawn as never, killGroup: vi.fn() });
    for (const arg of [[0], [255], [192, 128]]) expect(() => launcher.launch({ ...spec, args: [arg] }, { async output() {}, async end() {} })).toThrow();
    expect(spawn).not.toHaveBeenCalled();
  });
  it('rejects missing argv octets and missing argv entries before spawn', () => {
    const spawn = vi.fn();
    const launcher = createNativeLauncher({ spawn: spawn as never, killGroup: vi.fn() });
    const octets = new Array<number>(2); octets[1] = 97;
    const args = new Array<number[]>(1);
    for (const value of [[octets], args]) {
      expect(() => launcher.launch({ ...spec, args: value }, { async output() {}, async end() {} })).toThrow();
    }
    expect(spawn).not.toHaveBeenCalled();
  });
  it('records exit while output settlement remains blocked by a slow sink', async () => {
    const child = fakeChild(); let release!: () => void; const slow = new Promise<void>(r => { release = r; }); const received: Uint8Array[] = [];
    const run = createNativeLauncher({ spawn: (() => child) as never, killGroup: vi.fn() }).launch(spec, { async output(channel, bytes) { if (channel === 2) { received.push(bytes.slice()); await slow; } }, async end() {} });
    child.stdio[1].write(new Uint8Array([0, 255])); child.stdio[1].end(); child.stdio[2].end();
    child.emit('exit', 0, null); child.emit('close', 0, null);
    expect(await run.exit).toEqual({ kind: 'exited', exitCode: 0 });
    let settled = false; void run.settled.then(() => { settled = true; }); await Promise.resolve(); expect(settled).toBe(false);
    release(); await run.settled; expect(received).toEqual([new Uint8Array([0, 255])]);
  });
  it('preserves signal independently of spawn errno', async () => {
    const child = fakeChild(); const killGroup = vi.fn();
    const run = createNativeLauncher({ spawn: (() => child) as never, killGroup }).launch(spec, { async output() {}, async end() {} });
    run.signal('SIGTERM'); expect(killGroup).toHaveBeenCalledWith(123, 'SIGTERM');
    child.stdio[1].end(); child.stdio[2].end(); child.emit('exit', null, 'SIGTERM'); child.emit('close', null, 'SIGTERM');
    expect(await run.exit).toEqual({ kind: 'signaled', signal: 'SIGTERM', signalNumber: 15 }); await run.settled;
    const failed = fakeChild();
    const other = createNativeLauncher({ spawn: (() => failed) as never, killGroup }).launch(spec, { async output() {}, async end() {} });
    failed.stdio[1].end(); failed.stdio[2].end(); failed.emit('error', Object.assign(new Error('private path'), { code: 'ENOENT' })); failed.emit('close', -2, null);
    expect(await other.exit).toEqual({ kind: 'spawnError', code: 'ENOENT', stage: 'spawn', message: 'Native process could not be started' }); await other.settled;
  });
  it('keeps extra descriptor output separate and does not implicitly close input on empty DATA', async () => {
    const child = fakeChild(); const output = vi.fn(); const end = vi.fn();
    const run = createNativeLauncher({ spawn: (() => child) as never, killGroup: vi.fn() }).launch({ ...spec, outputChannels: [2, 3, 4] }, { output, end });
    await run.write(1, new Uint8Array()); expect(child.stdio[0].writableEnded).toBe(false);
    await run.end(1); expect(child.stdio[0].writableEnded).toBe(true);
    child.stdio[1].end(); child.stdio[2].end(); child.stdio[3].end(new Uint8Array([128])); child.emit('exit', 0, null); child.emit('close', 0, null);
    await run.settled; expect(output).toHaveBeenCalledWith(4, new Uint8Array([128])); expect(end).toHaveBeenCalledWith(4);
  });
});
it('preserves an explicit native status even when a signal observation is also present', async () => {
 const child=fakeChild();const run=createNativeLauncher({spawn:(()=>child) as never,killGroup:vi.fn()}).launch(spec,{async output(){},async end(){}});
 child.stdio[1].end();child.stdio[2].end();child.emit('exit',42,'SIGTERM');child.emit('close',42,'SIGTERM');
 expect(await run.exit).toEqual({kind:'exited',exitCode:42});await run.settled;
});
it('can terminate descendants after the leader exits while inherited output remains open', async () => {
 const child=fakeChild();const killGroup=vi.fn();const run=createNativeLauncher({spawn:(()=>child) as never,killGroup}).launch(spec,{async output(){},async end(){}});
 child.emit('exit',0,null);await run.exit;run.signal('SIGTERM');expect(killGroup).toHaveBeenCalledWith(123,'SIGTERM');
 child.stdio[1].end();child.stdio[2].end();child.emit('close',0,null);await run.settled;
});
it('forwards supported group signals after leader pipes close until group retirement',async()=>{
 const child=fakeChild();let alive=true;const killGroup=vi.fn((_pid:number,signal:string)=>{if(signal==='SIGKILL')alive=false;});
 const run=createNativeLauncher({spawn:(()=>child)as never,killGroup,groupAlive:()=>alive}).launch(spec,{async output(){},async end(){}});
 child.stdio[1].end();child.stdio[2].end();child.emit('exit',42,null);child.emit('close',42,null);await run.settled;
 run.signal('SIGTERM');expect(killGroup).toHaveBeenCalledWith(123,'SIGTERM');await run.terminateGroup!();killGroup.mockClear();run.signal('SIGTERM');expect(killGroup).not.toHaveBeenCalled();expect(await run.exit).toEqual({kind:'exited',exitCode:42});
});
it('preserves a leading UTF-8 BOM as part of an argv token',async()=>{
 const child=fakeChild();const spawn=vi.fn(()=>child);
 const run=createNativeLauncher({spawn:spawn as never,killGroup:vi.fn()}).launch({...spec,args:[[239,187,191,120]]},{async output(){},async end(){}});
 expect(spawn.mock.calls[0][1]).toEqual(['\uFEFFx']);child.stdio[1].end();child.stdio[2].end();child.emit('exit',0,null);child.emit('close',0,null);await run.settled;
});
it('preserves a native input error without crashing or aborting sibling output channels',async()=>{
 const child=fakeChild();const output=vi.fn(async()=>{});const run=createNativeLauncher({spawn:(()=>child) as never,killGroup:vi.fn()}).launch(spec,{output,async end(){}});
 const cause=Object.assign(new Error('broken pipe'),{code:'EPIPE'});expect(()=>child.stdio[0].emit('error',cause)).not.toThrow();await expect(run.write(1,new Uint8Array([1]))).rejects.toBe(cause);
 child.stdio[1].end(new Uint8Array([9]));child.stdio[2].end();child.emit('exit',1,null);child.emit('close',1,null);await run.settled;expect(output).toHaveBeenCalledWith(2,new Uint8Array([9]));
});
it('releases a blocked native input writer during local transport retirement',async()=>{
 const child=fakeChild();const output=vi.fn(async()=>{});
 // A full writable pipe with no native reader leaves this admitted write pending.
 child.stdio[0]=new PassThrough({highWaterMark:1});
 const run=createNativeLauncher({spawn:(()=>child)as never,killGroup:vi.fn()}).launch(spec,{output,async end(){}});
 const writing=run.write(1,new Uint8Array([1,2]));
 const rejected=expect(writing).rejects.toMatchObject({code:'EPIPE'});
 const supported='closeInput' in run&&typeof run.closeInput==='function';
 if(supported)(run.closeInput as (channel:number)=>void)(1);
 else {child.stdio[0].emit('error',Object.assign(new Error('fixture release'),{code:'EPIPE'}));child.stdio[0].resume();}
 await rejected;
 child.stdio[1].end(new Uint8Array([9]));child.stdio[2].end();child.emit('exit',7,null);child.emit('close',7,null);await run.settled;
 expect(supported).toBe(true);expect(output).toHaveBeenCalledWith(2,new Uint8Array([9]));
});

it('checks and reaps an inherited process group even after all leader descriptors close',async()=>{
 const child=fakeChild();let alive=true;const killGroup=vi.fn(()=>{alive=false;});
 const run=createNativeLauncher({spawn:(()=>child) as never,killGroup,groupAlive:()=>alive}).launch(spec,{async output(){},async end(){}});
 child.stdio[1].end();child.stdio[2].end();child.emit('exit',0,null);child.emit('close',0,null);await run.settled;
 await run.terminateGroup!();expect(killGroup).toHaveBeenCalledWith(123,'SIGKILL');expect(alive).toBe(false);
});

it('reports unconfirmed process-group termination separately from a successful leader exit',async()=>{
 vi.useFakeTimers();try{
  const child=fakeChild();const run=createNativeLauncher({spawn:(()=>child) as never,killGroup:vi.fn(),groupAlive:()=>true,terminationTimeoutMs:10}).launch(spec,{async output(){},async end(){}});
  child.stdio[1].end();child.stdio[2].end();child.emit('exit',0,null);child.emit('close',0,null);await run.settled;
  const rejection=expect(run.terminateGroup!()).rejects.toMatchObject({category:'transport',code:'termination-unconfirmed'});
  await vi.advanceTimersByTimeAsync(11);await rejection;expect(await run.exit).toEqual({kind:'exited',exitCode:0});
 }finally{vi.useRealTimers();}
});

it('treats an EPERM group probe as existence and confirms retirement only after ESRCH',async()=>{
 const child=fakeChild();const denied=Object.assign(new Error('probe denied'),{code:'EPERM'});
 const missing=Object.assign(new Error('group gone'),{code:'ESRCH'});
 const probe=vi.spyOn(process,'kill').mockImplementationOnce(()=>{throw denied;}).mockImplementationOnce(()=>{throw missing;});
 const killGroup=vi.fn(()=>{throw denied;});
 try{
  const run=createNativeLauncher({spawn:(()=>child)as never,killGroup}).launch(spec,{async output(){},async end(){}});
  child.stdio[1].end();child.stdio[2].end();child.emit('exit',7,null);child.emit('close',7,null);await run.settled;
  await expect(run.terminateGroup!()).resolves.toBeUndefined();
  expect(probe).toHaveBeenCalledTimes(2);expect(killGroup).toHaveBeenCalledWith(123,'SIGKILL');
  expect(await run.exit).toEqual({kind:'exited',exitCode:7});
 }finally{probe.mockRestore();}
});

it('reports denied retirement as unconfirmed when the group remains present',async()=>{
 vi.useFakeTimers();try{
  const child=fakeChild();const denied=Object.assign(new Error('signal denied'),{code:'EPERM'});
  const run=createNativeLauncher({spawn:(()=>child)as never,killGroup(){throw denied;},groupAlive:()=>true,terminationTimeoutMs:10}).launch(spec,{async output(){},async end(){}});
  child.stdio[1].end();child.stdio[2].end();child.emit('exit',7,null);child.emit('close',7,null);await run.settled;
  const rejected=expect(run.terminateGroup!()).rejects.toMatchObject({category:'transport',code:'termination-unconfirmed',cause:denied});
  void rejected.catch(()=>{});
  await vi.advanceTimersByTimeAsync(11);await rejected;expect(await run.exit).toEqual({kind:'exited',exitCode:7});
 }finally{vi.useRealTimers();}
});
