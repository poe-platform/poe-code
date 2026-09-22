import {expect, it, vi} from 'vitest';
import {createNativeDriver} from './native-driver.js';

it.each([NaN, Infinity, 0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])(
  'rejects malformed requested argv budget %s before inspecting tokens or preparing the namespace', async maxArgvBytes => {
    const prepare = vi.fn(async () => ({cwd: '/private', env: {}, async close() {}}));
    const launch = vi.fn();
    const driver = createNativeDriver({launcher: {launch}, backend: {
      limits: {maxArgvBytes: 64}, features: [], inspectBuild: vi.fn(),
      async admitSession() {return {prepare, async close() {}};},
    }});
    const signal = new AbortController().signal;
    const authority = await driver.admitSession({principal: {tenantId: 't', principalId: 'p', expiresAt: 999999}, request: {} as never, signal});
    const args = [[]];
    const inspectToken = vi.fn(() => []);
    Object.defineProperty(args, 0, {get: inspectToken});
    try {
      await expect(authority.prepare({jobId: 'j', tool: {executable: '/tool'} as never,
        build: {runtimeEnvironment: {}} as never, hooks: {} as never, signal,
        request: {args, env: {}, stdin: {kind: 'stream'}, descriptors: [], limits: {maxFrameBytes: 64, maxArgvBytes}} as never,
      })).rejects.toThrow('argv bound');
      expect(inspectToken).not.toHaveBeenCalled();
      expect(prepare).not.toHaveBeenCalled();
      expect(launch).not.toHaveBeenCalled();
    } finally {await authority.close();}
  },
);

it('rejects a missing mandatory frame budget before namespace preparation', async () => {
  const prepare = vi.fn(async () => ({cwd: '/private', env: {}, async close() {}}));
  const launch = vi.fn();
  const driver = createNativeDriver({launcher: {launch}, backend: {
    features: [], inspectBuild: vi.fn(), async admitSession() {return {prepare, async close() {}};},
  }});
  const signal = new AbortController().signal;
  const authority = await driver.admitSession({principal: {tenantId: 't', principalId: 'p', expiresAt: 999999}, request: {} as never, signal});
  try {
    await expect(authority.prepare({jobId: 'j', tool: {executable: '/tool'} as never,
      build: {runtimeEnvironment: {}} as never, hooks: {} as never, signal,
      request: {args: [], env: {}, stdin: {kind: 'stream'}, descriptors: [], limits: {}} as never,
    })).rejects.toThrow('frame bound');
    expect(prepare).not.toHaveBeenCalled();
    expect(launch).not.toHaveBeenCalled();
  } finally {await authority.close();}
});

it.each([
  {maxArgvBytes: Infinity}, {maxArgvBytes: NaN}, {maxArgvBytes: 0}, {maxArgvBytes: -1}, {maxArgvBytes: 1.5},
  {maxFrameBytes: Infinity}, {maxFrameBytes: NaN}, {maxFrameBytes: 0}, {maxFrameBytes: 1.5},
  {maxFrameBytes: 1048577},
])('rejects malformed configured native ceilings %j before acquiring a session', limits => {
  const admitSession = vi.fn();
  expect(() => createNativeDriver({launcher: {launch: vi.fn()}, backend: {
    limits, features: [], inspectBuild: vi.fn(), admitSession,
  }})).toThrow('bound');
  expect(admitSession).not.toHaveBeenCalled();
});
