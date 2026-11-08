import {expect, it, vi} from 'vitest';
import {createNativeDriver} from './native-driver.js';

it.each([
  {rights: 'readwrite'}, {rights: ['read', 'read']}, {rights: ['unknown']}, {rights: new Array(1)},
  {rights: ['read', 'write', 'seek', 'stat', 'read']},
])('rejects malformed descriptor rights $rights before namespace acquisition', async ({rights}) => {
  const prepare = vi.fn(async () => ({cwd: '/work', env: {}, async close() {}}));
  const launch = vi.fn();
  const driver = createNativeDriver({launcher: {launch}, backend: {
    features: [], inspectBuild: vi.fn(), async admitSession() {
      return {prepare, async close() {}};
    },
  }});
  const signal = new AbortController().signal;
  const authority = await driver.admitSession({principal: {tenantId: 't', principalId: 'p', expiresAt: 999999}, request: {} as never, signal});
  try {
    const pending = authority.prepare({jobId: 'j', tool: {executable: '/tool'} as never,
      build: {runtimeEnvironment: {}} as never, hooks: {} as never, signal,
      request: {args: [], env: {}, stdin: {kind: 'stream'}, limits: {maxFrameBytes: 64},
        descriptors: [{fd: 3, openDescriptionId: 'o', rights, seekable: false}]} as never,
    });
    // Retire any accidentally admitted invocation before asserting the failure.
    let failure: unknown;
    try {await (await pending).close();} catch (cause) {failure = cause;}
    expect(failure).toBeInstanceOf(TypeError);
    expect(prepare).not.toHaveBeenCalled();
    expect(launch).not.toHaveBeenCalled();
  } finally {await authority.close();}
});

it('admits rights by dense own slots without trusting array methods or iterators', async () => {
  const rights = ['stat'];
  rights.includes = () => true;
  rights[Symbol.iterator] = function* () {yield 'read'; yield 'write';};
  const prepare = vi.fn(async () => ({cwd: '/work', env: {}, stdio: ['pipe', 'pipe', 'pipe', 'ignore'] as const, async close() {}}));
  const launch = vi.fn(() => ({exit: Promise.resolve({kind: 'spawnError' as const, code: 'ENOENT', stage: 'spawn' as const, message: 'fixture'}), settled: Promise.resolve(), async write() {}, async end() {}, signal() {}}));
  const driver = createNativeDriver({launcher: {launch}, backend: {
    features: [], inspectBuild: vi.fn(), async admitSession() {return {prepare, async close() {}};},
  }});
  const signal = new AbortController().signal;
  const authority = await driver.admitSession({principal: {tenantId: 't', principalId: 'p', expiresAt: 999999}, request: {} as never, signal});
  try {
    const invocation = await authority.prepare({jobId: 'j', tool: {executable: '/tool'} as never,
      build: {runtimeEnvironment: {}} as never, hooks: {} as never, signal,
      request: {args: [], env: {}, stdin: {kind: 'stream'}, limits: {maxFrameBytes: 64},
        descriptors: [{fd: 3, openDescriptionId: 'o', rights, seekable: false}]} as never,
    });
    invocation.start({async output() {}, async end() {}});
    expect(launch).toHaveBeenCalledWith(expect.objectContaining({inputChannels: [1], outputChannels: [2, 3]}), expect.anything());
    await invocation.close();
  } finally {await authority.close();}
});
