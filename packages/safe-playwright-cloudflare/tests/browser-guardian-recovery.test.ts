import { afterEach, expect, test, vi } from 'vitest';
import { rmSync } from 'node:fs';
import { browserProcessInventory } from './browser-process-inventory.mjs';
import { execFileSync } from 'node:child_process';

vi.mock('node:fs', () => ({ rmSync: vi.fn() }));
vi.mock('node:child_process', () => ({ execFileSync: vi.fn() }));
vi.mock('./browser-process-inventory.mjs', () => ({ browserProcessInventory: vi.fn() }));
vi.mock('node:timers/promises', () => ({ setTimeout: vi.fn(async () => {}) }));

afterEach(() => { vi.restoreAllMocks(); vi.resetAllMocks(); });

test('guardian keeps ownership after inspection fails and verifies helpers before retiring', async () => {
  type Listener = (message?: { operation: string; pid: number; directory: string }) => void | Promise<void>;
  const listeners = new Map<string, Listener>();
  vi.spyOn(process, 'on').mockImplementation(((event: string, listener: Listener) => {
    listeners.set(event, listener); return process;
  }) as typeof process.on);
  vi.spyOn(process, 'kill').mockReturnValue(true);
  const exit = vi.spyOn(process, 'exit').mockImplementation((() => {}) as typeof process.exit);
  const report = vi.spyOn(console, 'error').mockImplementation(() => {});
  const failure = Object.assign(new Error('ps timed out'), { code: 'ETIMEDOUT' });
  vi.mocked(browserProcessInventory).mockRejectedValueOnce(failure).mockImplementationOnce(async () => {
    expect(rmSync).not.toHaveBeenCalled();
    expect(exit).not.toHaveBeenCalled();
    expect(report).toHaveBeenCalled();
    return '23456 chrome_crashpad_handler\n34567 chrome_crashpad_handler\n';
  }).mockResolvedValueOnce('');
  vi.mocked(execFileSync).mockReturnValue('p23456\nn/owned\np34567\nn/unrelated\n');
  await import('./browser-process-lifetime.guardian.mjs');
  listeners.get('message')!({ operation: 'own', pid: 12345, directory: '/owned' });
  listeners.get('message')!({ operation: 'retire', pid: 12345, directory: '/owned' });
  listeners.get('message')!({ operation: 'retire', pid: 12345, directory: '/owned' });
  await listeners.get('disconnect')!();
  expect(browserProcessInventory).toHaveBeenCalledTimes(3);
  expect(process.kill).toHaveBeenCalledWith(-12345, 'SIGKILL');
  expect(process.kill).toHaveBeenCalledWith(23456, 'SIGKILL');
  expect(process.kill).not.toHaveBeenCalledWith(34567, 'SIGKILL');
  expect(process.kill).toHaveBeenCalledTimes(2);
  expect(rmSync).toHaveBeenCalledWith('/owned', { recursive: true, force: true });
  expect(exit).toHaveBeenCalledWith(0);
});
