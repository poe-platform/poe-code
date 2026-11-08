import {expect, it, vi} from 'vitest';
import {createNativeDriver} from './native-driver.js';

it.each(['read', 'write'] as const)('retires excessive %s streams before handing off a prepared invocation', async right => {
  const close = vi.fn(async () => {});
  const launch = vi.fn();
  const driver = createNativeDriver({launcher: {launch}, backend: {
    features: [], inspectBuild: vi.fn(), async admitSession() {
      return {async close() {}, async prepare() {return {cwd: '/work', env: {}, close};}};
    },
  }});
  const signal = new AbortController().signal;
  const authority = await driver.admitSession({principal: {tenantId: 't', principalId: 'p', expiresAt: 999999}, request: {} as never, signal});
  // Standard stdin consumes one input channel; stdout/stderr consume two outputs.
  const count = right === 'read' ? 64 : 63;
  const descriptors = Array.from({length: count}, (_, index) => ({
    fd: index + 3, openDescriptionId: String(index), rights: [right], seekable: false,
  }));
  try {
    await expect(authority.prepare({jobId: 'j', tool: {executable: '/tool'} as never,
      build: {runtimeEnvironment: {}} as never, hooks: {} as never, signal,
      request: {args: [], env: {}, stdin: {kind: 'stream'}, descriptors, limits: {maxFrameBytes: 64}} as never,
    })).rejects.toThrow('Native stream capacity');
    expect(close).toHaveBeenCalledOnce();
    expect(launch).not.toHaveBeenCalled();
  } finally {await authority.close();}
});

it.each(['read', 'write'] as const)('admits the exact %s stream ceiling while preserving retained descriptors', async right => {
  const close = vi.fn(async () => {});
  const launch = vi.fn(() => ({exit: Promise.resolve({kind: 'exited' as const, exitCode: 0}),
    settled: Promise.resolve(), async write() {}, async end() {}, signal() {}, async terminateGroup() {},
  }));
  const count = right === 'read' ? 63 : 62;
  const descriptors = Array.from({length: count + 2}, (_, index) => ({
    fd: index + 3, openDescriptionId: String(index), rights: [right], seekable: false,
  }));
  const stdio: ('pipe' | number)[] = Array.from({length: descriptors.length + 3}, (_, fd) => fd >= count + 3 ? 17 + fd : 'pipe');
  const driver = createNativeDriver({launcher: {launch}, backend: {
    features: [], inspectBuild: vi.fn(), async admitSession() {
      return {async close() {}, async prepare() {return {cwd: '/work', env: {}, stdio, close};}};
    },
  }});
  const signal = new AbortController().signal;
  const authority = await driver.admitSession({principal: {tenantId: 't', principalId: 'p', expiresAt: 999999}, request: {} as never, signal});
  try {
    const prepared = await authority.prepare({jobId: 'j', tool: {executable: '/tool'} as never,
      build: {runtimeEnvironment: {}} as never, hooks: {} as never, signal,
      request: {args: [], env: {}, stdin: {kind: 'stream'}, descriptors, limits: {maxFrameBytes: 64}} as never,
    });
    prepared.start({async output() {}, async end() {}});
    expect(launch.mock.calls[0]?.[0][right === 'read' ? 'inputChannels' : 'outputChannels']).toHaveLength(64);
    expect(launch.mock.calls[0]?.[0].stdio).toEqual(stdio);
    await prepared.close();
    expect(close).toHaveBeenCalledOnce();
  } finally {await authority.close();}
});
