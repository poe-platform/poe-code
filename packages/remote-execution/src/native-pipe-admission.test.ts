import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {expect, it, vi} from 'vitest';
import {createNativeLauncher} from './native-process.js';
import {createNativeDriver} from './native-driver.js';

const spec = {executable: '/tool', args: [], cwd: '/work', env: {},
 inputChannels: [1], outputChannels: [2, 3], maxFrameBytes: 64};

it('retires an installed descriptor pipe without byte rights before transferring invocation ownership', async () => {
 const close = vi.fn(async () => {});
 const launch = vi.fn();
 const driver = createNativeDriver({launcher: {launch}, backend: {
  features: [], inspectBuild: vi.fn(), async admitSession() {
   return {async close() {}, async prepare() {
    return {cwd: '/work', env: {}, stdio: ['pipe', 'pipe', 'pipe', 'pipe'] as const, close};
   }};
  },
 }});
 const signal = new AbortController().signal;
 const authority = await driver.admitSession({principal: {tenantId: 't', principalId: 'p', expiresAt: 999999}, request: {} as never, signal});
 try {
  await expect(authority.prepare({jobId: 'j', tool: {executable: '/tool'} as never,
   build: {runtimeEnvironment: {}} as never, hooks: {} as never, signal,
   request: {args: [], env: {}, stdin: {kind: 'stream'}, limits: {maxFrameBytes: 64},
    descriptors: [{fd: 3, openDescriptionId: 'o', rights: ['stat'], seekable: false}]} as never,
  })).rejects.toThrow('native pipe');
  expect(close).toHaveBeenCalledOnce();
  expect(launch).not.toHaveBeenCalled();
 } finally {await authority.close();}
});

it.each([0, 1, 2, 3])('refuses a pipe without channel ownership at descriptor %s before allocation', async fd => {
 const child = Object.assign(new EventEmitter(), {pid: 123,
  stdio: Array.from({length: 4}, () => new PassThrough())});
 const spawn = vi.fn(() => child);
 const inputChannels = fd === 0 ? [] : [1];
 const outputChannels = [2, 3].filter(channel => channel !== fd + 1);
 const stdio = fd === 3 ? ['pipe', 'pipe', 'pipe', 'pipe'] : ['pipe', 'pipe', 'pipe'];
 const launcher = createNativeLauncher({spawn: spawn as never});
 let failure: unknown;
 try {
  const run = launcher.launch({...spec, inputChannels, outputChannels, stdio: stdio as 'pipe'[]},
   {async output() {}, async end() {}});
  // A regression must not leave fixture streams or unobserved settlement behind.
  for (const stream of child.stdio) stream.end();
  child.emit('exit', 0, null); child.emit('close', 0, null);
  await run.settled;
 } catch (cause) {failure = cause;}
 expect(failure).toBeInstanceOf(TypeError);
 expect(spawn).not.toHaveBeenCalled();
});

it('keeps ignored holes and trusted retained leases independent of streamed channels', async () => {
 const child = Object.assign(new EventEmitter(), {pid: 123,
  stdio: [new PassThrough(), new PassThrough(), new PassThrough(), null, null]});
 const spawn = vi.fn(() => child);
 const run = createNativeLauncher({spawn: spawn as never}).launch({ ...spec,
  stdio: ['pipe', 'pipe', 'pipe', 'ignore', 17]}, {async output() {}, async end() {}});
 child.stdio[1]!.end(); child.stdio[2]!.end();
 child.emit('exit', 0, null); child.emit('close', 0, null);
 await run.settled;
 expect(spawn).toHaveBeenCalledOnce();
 expect(await run.exit).toEqual({kind: 'exited', exitCode: 0});
});
