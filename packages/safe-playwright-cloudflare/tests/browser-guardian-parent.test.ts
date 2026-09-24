import { EventEmitter } from 'node:events';
import { afterEach, expect, test, vi } from 'vitest';
import childProcess from 'node:child_process';

vi.mock('node:child_process', () => ({ default: { spawn: vi.fn(), fork: vi.fn() } }));
vi.mock('node:module', () => ({ syncBuiltinESMExports: vi.fn() }));
vi.mock('node:fs', () => ({ mkdirSync: vi.fn(), mkdtempSync: vi.fn(() => '/owned'), rmSync: vi.fn() }));

afterEach(() => vi.restoreAllMocks());

test('parent reports guardian death and refuses to launch another unprotected browser', async () => {
  const guardian = Object.assign(new EventEmitter(), {
    connected: true, unref: vi.fn(), channel: { unref: vi.fn() }, send: vi.fn(),
  });
  const browser = Object.assign(new EventEmitter(), { pid: 12345 });
  const spawn = vi.mocked(childProcess.spawn).mockReturnValue(browser as never);
  vi.mocked(childProcess.fork).mockReturnValue(guardian as never);
  await import('./browser-process-lifetime.setup.mjs');
  const launch = () => childProcess.spawn('chrome', ['--user-data-dir=/browser-rendering/profile-test'], { detached: true });
  launch();
  expect(guardian.send).toHaveBeenCalledWith({ operation: 'own', pid: 12345, directory: '/owned' });
  expect(() => guardian.emit('exit', 1, null)).toThrow('owned browser cleanup is unverified');
  guardian.connected = false;
  expect(() => browser.emit('exit', 0)).toThrow('owned browser cleanup is unverified');
  expect(() => launch()).toThrow('owned browser cleanup is unverified');
  expect(spawn).toHaveBeenCalledOnce();
  expect(guardian.send).toHaveBeenCalledOnce();
});
