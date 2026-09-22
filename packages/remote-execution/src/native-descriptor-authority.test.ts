import {expect, it, vi} from 'vitest';
import {createNativeDriver} from './native-driver.js';

it.each([
  ['ignore', 'pipe', 'pipe'],
  [17, 'pipe', 'pipe'],
  ['pipe', 'ignore', 'pipe'],
  ['pipe', 17, 'pipe'],
  ['pipe', 'pipe', 'ignore'],
  ['pipe', 'pipe', 17],
].map(stdio => ({stdio: stdio as ('pipe' | 'ignore' | number)[]})))('retires a namespace whose standard stream mapping is not the admitted pipe: %j', async ({stdio}) => {
  const close = vi.fn(async () => {});
  const launch = vi.fn();
  const signal = new AbortController().signal;
  const driver = createNativeDriver({launcher: {launch}, backend: {
    features: [], inspectBuild: vi.fn(), async admitSession() {
      return {async close() {}, async prepare() {return {cwd: '/work', env: {}, stdio, close};}};
    },
  }});
  const authority = await driver.admitSession({principal: {tenantId: 't', principalId: 'p', expiresAt: 999999}, request: {} as never, signal});
  try {
    await expect(authority.prepare({jobId: 'j', tool: {executable: '/tool'} as never,
      build: {runtimeEnvironment: {}} as never,
      request: {args: [], env: {}, stdin: {kind: 'stream'}, descriptors: [], limits: {maxFrameBytes: 64}} as never,
      hooks: {} as never, signal})).rejects.toThrow('admitted channel');
    expect(launch).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledOnce();
  } finally {await authority.close();}
});

it.each([17, 'pipe'] as const)('refuses an undeclared installed descriptor %s before launch', async extra => {
  const close = vi.fn(async () => {});
  const launch = vi.fn();
  const signal = new AbortController().signal;
  const driver = createNativeDriver({launcher: {launch}, backend: {
    features: [], inspectBuild: vi.fn(), async admitSession() {
      return {async close() {}, async prepare() {
        return {cwd: '/work', env: {}, stdio: ['pipe', 'pipe', 'pipe', extra] as ('pipe' | number)[], close};
      }};
    },
  }});
  const authority = await driver.admitSession({principal: {tenantId: 't', principalId: 'p', expiresAt: 999999}, request: {} as never, signal});
  try {
    await expect(authority.prepare({jobId: 'j', tool: {executable: '/tool'} as never,
      build: {runtimeEnvironment: {}} as never,
      request: {args: [], env: {}, stdin: {kind: 'stream'}, descriptors: [], limits: {maxFrameBytes: 64}} as never,
      hooks: {} as never, signal})).rejects.toThrow('Unadmitted installed native descriptor');
    expect(launch).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledOnce();
  } finally {await authority.close();}
});

it('admits an explicit retained descriptor after ignored table holes', async () => {
  const close = vi.fn(async () => {});
  const launch = vi.fn(() => ({exit: Promise.resolve({kind: 'exited' as const, exitCode: 0}),
    settled: Promise.resolve(), async write() {}, async end() {}, signal() {}, async terminateGroup() {}}));
  const signal = new AbortController().signal;
  const stdio = ['pipe', 'pipe', 'pipe', 'ignore', 17] as ('pipe' | 'ignore' | number)[];
  const driver = createNativeDriver({launcher: {launch}, backend: {
    features: [], inspectBuild: vi.fn(), async admitSession() {
      return {async close() {}, async prepare() {return {cwd: '/work', env: {}, stdio, close};}};
    },
  }});
  const authority = await driver.admitSession({principal: {tenantId: 't', principalId: 'p', expiresAt: 999999}, request: {} as never, signal});
  try {
    const prepared = await authority.prepare({jobId: 'j', tool: {executable: '/tool'} as never,
      build: {runtimeEnvironment: {}} as never,
      request: {args: [], env: {}, stdin: {kind: 'stream'}, descriptors: [{fd: 4, openDescriptionId: 'retained', rights: ['read', 'seek'], seekable: true}], limits: {maxFrameBytes: 64}} as never,
      hooks: {} as never, signal});
    prepared.start({async output() {}, async end() {}});
    expect(launch).toHaveBeenCalledWith(expect.objectContaining({stdio, inputChannels: [1], outputChannels: [2, 3]}), expect.anything());
    await prepared.close();
    expect(close).toHaveBeenCalledOnce();
  } finally {await authority.close();}
});
