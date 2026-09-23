import { afterEach, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ inspect: vi.fn(), remove: vi.fn(), delay: vi.fn(async () => {}) }));
vi.mock('node:child_process', () => ({ execFileSync: mocks.inspect }));
vi.mock('node:fs', () => ({ rmSync: mocks.remove }));
vi.mock('node:timers/promises', () => ({ setTimeout: mocks.delay }));

afterEach(() => { vi.restoreAllMocks(); vi.resetModules(); mocks.inspect.mockReset(); mocks.remove.mockReset(); mocks.delay.mockClear(); });

for (const failingCommand of ['ps', 'lsof']) for (const failures of [1, 50]) test(`guardian handles ${failures} ${failingCommand} inspection timeouts`, async () => {
  const handlers = new Map<string | symbol, (...args: unknown[]) => unknown>();
  vi.spyOn(process, 'on').mockImplementation((event, listener) => { handlers.set(event, listener); return process; });
  vi.spyOn(process, 'kill').mockReturnValue(true);
  const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
  let remaining = failures;
  const failure = Object.assign(new Error('process inspection timed out'), { code: 'ETIMEDOUT' });
  mocks.inspect.mockImplementation((command: string) => {
    if (command === failingCommand && remaining-- > 0) throw failure;
    return command === 'ps' && failingCommand === 'lsof' ? '12345 chrome_crashpad_handler\n' : '';
  });
  await import('./browser-process-lifetime.guardian.mjs');
  handlers.get('message')!({ operation: 'own', pid: 12344, directory: '/synthetic-owned-browser' });
  const completion = Promise.resolve(handlers.get('disconnect')!()).then(() => undefined, error => error);
  expect(await completion).toBe(failures === 1 ? undefined : failure);
  expect(mocks.inspect.mock.calls.filter(([command]) => command === failingCommand)).toHaveLength(failures === 1 ? 2 : 50);
  expect(mocks.delay).toHaveBeenCalledTimes(failures === 1 ? 1 : 49);
  if (failures === 1) {
    expect(mocks.remove).toHaveBeenCalledWith('/synthetic-owned-browser', { recursive: true, force: true });
    expect(exit).toHaveBeenCalledWith(0);
  } else {
    expect(mocks.remove).not.toHaveBeenCalled();
    expect(exit).not.toHaveBeenCalled();
  }
  expect(process.kill).toHaveBeenCalledWith(-12344, 'SIGKILL');
});
