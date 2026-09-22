import {expect, it, vi} from 'vitest';
import {createNativeDriver} from './native-driver.js';

it.each([{rights: ['read']}, {rights: ['write']}, {rights: ['stat']}, {rights: []}])('refuses seekable descriptors without seek authority before preparation: %j', async ({rights}) => {
 const prepare = vi.fn(async () => ({cwd: '/private', env: {}, stdio: ['ignore', 'pipe', 'pipe', 9], async close() {}}));
 const launch = vi.fn();
 const driver = createNativeDriver({launcher: {launch}, backend: {
  features: [], inspectBuild: vi.fn(), async admitSession() {return {prepare, async close() {}};},
 }});
 const signal = new AbortController().signal;
 const authority = await driver.admitSession({principal: {tenantId: 't', principalId: 'p', expiresAt: 999999}, request: {} as never, signal});
 try {
  await expect(authority.prepare({jobId: 'j', tool: {executable: '/tool'} as never,
   build: {runtimeEnvironment: {}} as never, hooks: {} as never, signal,
   request: {args: [], env: {}, stdin: {kind: 'stream'},
    descriptors: [{fd: 3, handleId: 'h', grantId: 'g', openDescriptionId: 'o', rights, seekable: true}],
    limits: {maxFrameBytes: 64, maxHandles: 1}} as never,
  })).rejects.toThrow('Native descriptor seek authority');
  expect(prepare).not.toHaveBeenCalled();
  expect(launch).not.toHaveBeenCalled();
 } finally {await authority.close();}
});

it('does not let a caller supplied rights method acquire seek authority', async () => {
 const rights = ['read'];
 Object.setPrototypeOf(rights, Object.assign(Object.create(Array.prototype), {includes: () => true}));
 const prepare = vi.fn(async () => ({cwd: '/private', env: {}, stdio: ['pipe', 'pipe', 'pipe', 9], async close() {}}));
 const driver = createNativeDriver({launcher: {launch: vi.fn()}, backend: {
  features: [], inspectBuild: vi.fn(), async admitSession() {return {prepare, async close() {}};},
 }});
 const signal = new AbortController().signal;
 const authority = await driver.admitSession({principal: {tenantId: 't', principalId: 'p', expiresAt: 999999}, request: {} as never, signal});
 try {
  await expect(authority.prepare({jobId: 'j', tool: {executable: '/tool'} as never,
   build: {runtimeEnvironment: {}} as never, hooks: {} as never, signal,
   request: {args: [], env: {}, stdin: {kind: 'stream'},
    descriptors: [{fd: 3, openDescriptionId: 'o', rights, seekable: true}], limits: {maxFrameBytes: 64}} as never,
  })).rejects.toThrow('Native descriptor seek authority');
  expect(prepare).not.toHaveBeenCalled();
 } finally {await authority.close();}
});

it.each([NaN, Infinity, 0, -1, 1.5])('refuses an invalid backend handle budget %s at configuration', maxHandles => {
 const admitSession = vi.fn();
 expect(() => createNativeDriver({launcher: {launch: vi.fn()}, backend: {
  limits: {maxHandles}, features: [], inspectBuild: vi.fn(), admitSession,
 }})).toThrow('Native descriptor bound');
 expect(admitSession).not.toHaveBeenCalled();
});

it.each([undefined, 2048])('advertises the native descriptor ceiling when backend maxHandles is %s', maxHandles => {
 const driver = createNativeDriver({launcher: {launch: vi.fn()}, backend: {
  limits: maxHandles === undefined ? {} : {maxHandles}, features: [], inspectBuild: vi.fn(), admitSession: vi.fn(),
 }});
 expect(driver.limits?.maxHandles).toBe(1021);
});

it.each(['capacity', 'mapping', 'duplicate', 'sparse', 'backend-ceiling'])('refuses %s before native namespace acquisition', async kind => {
 const prepare = vi.fn(async () => ({cwd: '/private', env: {}, async close() {}}));
 const launch = vi.fn();
 const driver = createNativeDriver({launcher: {launch}, backend: {
  limits: {maxHandles: 80}, features: [], inspectBuild: vi.fn(),
  async admitSession() {return {prepare, async close() {}};},
 }});
 const signal = new AbortController().signal;
 const authority = await driver.admitSession({principal: {tenantId: 't', principalId: 'p', expiresAt: 999999}, request: {} as never, signal});
 const descriptor = (fd: number) => ({fd, openDescriptionId: String(fd), rights: ['read'], seekable: false});
 const descriptors = kind === 'capacity' ? [descriptor(3), descriptor(4)]
  : kind === 'mapping' ? [descriptor(4)]
  : kind === 'duplicate' ? [descriptor(3), descriptor(3)]
  : kind === 'backend-ceiling' ? Array.from({length: 81}, (_, index) => descriptor(index + 3))
  : new Array(1);
 // An over-budget table must be refused without visiting its entries.
 if (kind === 'capacity') Object.defineProperty(descriptors, 0, {get() {throw new Error('Unadmitted descriptor accessed');}});
 try {
  await expect(authority.prepare({jobId: 'j', tool: {executable: '/tool'} as never,
   build: {runtimeEnvironment: {}} as never,
   request: {args: [], env: {}, stdin: {kind: 'stream'}, descriptors,
    limits: {maxFrameBytes: 64, maxHandles: kind === 'capacity' || kind === 'mapping' ? 1 : 81}} as never,
   hooks: {} as never, signal,
  })).rejects.toThrow('Native descriptor');
  expect(prepare).not.toHaveBeenCalled();
  expect(launch).not.toHaveBeenCalled();
 } finally {await authority.close();}
});

it('retains admitted descriptor slots and fds through preparation and launch', async () => {
 let slotReads = 0; let fdReads = 0;
 const descriptor = {get fd() {return ++fdReads === 1 ? 3 : 4;}, openDescriptionId: 'o', rights: ['read'], seekable: false};
 const descriptors = [descriptor];
 Object.defineProperty(descriptors, 0, {get() {slotReads++; return descriptor;}});
 const prepare = vi.fn(async () => ({cwd: '/private', env: {}, async close() {}}));
 const launch = vi.fn(() => ({exit: Promise.resolve({kind: 'exited' as const, exitCode: 0}),
  settled: Promise.resolve(), async write() {}, async end() {}, signal() {}, async terminateGroup() {},
 }));
 const driver = createNativeDriver({launcher: {launch}, backend: {
  features: [], inspectBuild: vi.fn(), async admitSession() {return {prepare, async close() {}};},
 }});
 const signal = new AbortController().signal;
 const authority = await driver.admitSession({principal: {tenantId: 't', principalId: 'p', expiresAt: 999999}, request: {} as never, signal});
 try {
  const invocation = await authority.prepare({jobId: 'j', tool: {executable: '/tool'} as never,
   build: {runtimeEnvironment: {}} as never,
   request: {args: [], env: {}, stdin: {kind: 'stream'}, descriptors, limits: {maxFrameBytes: 64, maxHandles: 1}} as never,
   hooks: {} as never, signal,
  });
  invocation.start({async output() {}, async end() {}});
  expect(prepare.mock.calls[0]?.[0]).toMatchObject({request: {descriptors: [{fd: 3}]}});
  expect(launch.mock.calls[0]?.[0]).toMatchObject({inputChannels: [1, 4], outputChannels: [2, 3]});
  expect({slotReads, fdReads}).toEqual({slotReads: 1, fdReads: 1});
  await invocation.close();
 } finally {await authority.close();}
});
