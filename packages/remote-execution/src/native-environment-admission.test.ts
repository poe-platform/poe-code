import {expect, it, vi} from 'vitest';
import {createNativeDriver} from './native-driver.js';

it.each([{}, {HOME: '/other'}])('refuses missing or conflicting runtime requirements before preparation: %j', async env => {
 const prepare = vi.fn();
 const launch = vi.fn();
 const signal = new AbortController().signal;
 const driver = createNativeDriver({launcher: {launch}, backend: {
  features: [], inspectBuild: vi.fn(),
  async admitSession() {return {prepare, async close() {}};},
 }});
 const authority = await driver.admitSession({principal: {tenantId: 't', principalId: 'p', expiresAt: 999999}, request: {} as never, signal});
 try {
  await expect(authority.prepare({jobId: 'j', tool: {executable: '/tool'} as never,
   build: {runtimeEnvironment: {HOME: '/runtime'}} as never,
   request: {args: [], env, stdin: {kind: 'stream'}, descriptors: [], limits: {maxFrameBytes: 64}} as never,
   hooks: {} as never, signal,
  })).rejects.toThrow('Native runtime environment conflict');
  expect(prepare).not.toHaveBeenCalled();
  expect(launch).not.toHaveBeenCalled();
 } finally {await authority.close();}
});

it('launches with the exact explicit environment after matching runtime requirements', async () => {
 const env = {HOME: '/runtime', USER_VALUE: 'literal $(value)'};
 const signal = new AbortController().signal;
 const launch = vi.fn(() => ({exit: Promise.resolve({kind: 'exited' as const, exitCode: 0}),
  settled: Promise.resolve(), async write() {}, async end() {}, signal() {}, async terminateGroup() {},
 }));
 const driver = createNativeDriver({launcher: {launch}, backend: {
  features: [], inspectBuild: vi.fn(),
  async admitSession() {return {async close() {}, async prepare() {
   return {cwd: '/private', env: {HOME: '/runtime'}, async close() {}};
  }};},
 }});
 const authority = await driver.admitSession({principal: {tenantId: 't', principalId: 'p', expiresAt: 999999}, request: {} as never, signal});
 try {
  const prepared = await authority.prepare({jobId: 'j', tool: {executable: '/tool'} as never,
   build: {runtimeEnvironment: {HOME: '/runtime'}} as never,
   request: {args: [], env, stdin: {kind: 'stream'}, descriptors: [], limits: {maxFrameBytes: 64}} as never,
   hooks: {} as never, signal,
  });
  env.USER_VALUE = 'changed after admission';
  prepared.start({async output() {}, async end() {}});
  expect(launch.mock.calls[0]?.[0]).toEqual(expect.objectContaining({
   env: {HOME: '/runtime', USER_VALUE: 'literal $(value)'},
  }));
  await prepared.close();
 } finally {await authority.close();}
});
