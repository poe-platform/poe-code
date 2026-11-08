import {expect, it, vi} from 'vitest';
import {createNativeDriver} from './native-driver.js';

it.each([0, -1, 1.5, 33, Infinity])('refuses frame budget %s before namespace preparation under the qualified driver ceiling', async maxFrameBytes => {
  const prepare = vi.fn(async () => ({cwd: '/work', env: {}, async close() {}}));
  const launch = vi.fn();
  const driver = createNativeDriver({launcher: {launch}, backend: {
    limits: {maxFrameBytes: 32}, features: [], inspectBuild: vi.fn(),
    async admitSession() {return {prepare, async close() {}};},
  }});
  const signal = new AbortController().signal;
  const authority = await driver.admitSession({principal: {tenantId: 't', principalId: 'p', expiresAt: 999999}, request: {} as never, signal});
  try {
    await expect(authority.prepare({jobId: 'j', tool: {executable: '/tool'} as never,
      build: {runtimeEnvironment: {}} as never, hooks: {} as never, signal,
      request: {args: [], env: {}, stdin: {kind: 'stream'}, descriptors: [], limits: {maxFrameBytes}} as never,
    })).rejects.toThrow('frame bound');
    expect(prepare).not.toHaveBeenCalled();
    expect(launch).not.toHaveBeenCalled();
  } finally {await authority.close();}
});

it('launches at the retained driver ceiling with the same admitted frame budget', async () => {
  const process = {exit: Promise.resolve({kind: 'exited' as const, exitCode: 0}), settled: Promise.resolve(),
    async write() {}, async end() {}, signal() {}, async terminateGroup() {}};
  const launch = vi.fn(() => process);
  const limits = {maxFrameBytes: 32};
  const driver = createNativeDriver({launcher: {launch}, backend: {
    limits, features: [], inspectBuild: vi.fn(),
    async admitSession() {return {async prepare() {return {cwd: '/work', env: {}, async close() {}};}, async close() {}};},
  }});
  limits.maxFrameBytes = 128;
  const signal = new AbortController().signal;
  const authority = await driver.admitSession({principal: {tenantId: 't', principalId: 'p', expiresAt: 999999}, request: {} as never, signal});
  const request = {args: [], env: {}, stdin: {kind: 'stream'}, descriptors: [], limits: {maxFrameBytes: 32}};
  const prepared = await authority.prepare({jobId: 'j', tool: {executable: '/tool'} as never,
    build: {runtimeEnvironment: {}} as never, hooks: {} as never, signal, request: request as never});
  try {
    request.limits.maxFrameBytes = 128;
    prepared.start({async output() {}, async end() {}});
    expect(launch).toHaveBeenCalledWith(expect.objectContaining({maxFrameBytes: 32}), expect.anything());
  } finally {await prepared.close(); await authority.close();}
});
