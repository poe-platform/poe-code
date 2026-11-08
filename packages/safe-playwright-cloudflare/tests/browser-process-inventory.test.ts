import { expect, test, vi, beforeEach } from 'vitest';

vi.mock('node:child_process', () => ({ execFileSync: vi.fn() }));
vi.mock('node:timers/promises', () => ({ setTimeout: vi.fn(async () => {}) }));
import { execFileSync } from 'node:child_process';
import { setTimeout } from 'node:timers/promises';
import { browserProcessInventory } from './browser-process-inventory.mjs';

beforeEach(() => vi.resetAllMocks());

test('retries a transient inventory timeout and returns the fresh inventory', async () => {
  vi.mocked(execFileSync).mockImplementationOnce(() => { throw Object.assign(new Error('ps timed out'), { code: 'ETIMEDOUT' }); }).mockReturnValueOnce('123 chrome_crashpad_handler\n');
  expect(await browserProcessInventory()).toBe('123 chrome_crashpad_handler\n');
  expect(execFileSync).toHaveBeenCalledTimes(2);
  expect(setTimeout).toHaveBeenCalledOnce();
});

test('persistent timeouts fail after the bounded retry budget', async () => {
  const error = Object.assign(new Error('ps timed out'), { code: 'ETIMEDOUT' });
  vi.mocked(execFileSync).mockImplementation(() => { throw error; });
  await expect(browserProcessInventory()).rejects.toBe(error);
  expect(execFileSync).toHaveBeenCalledTimes(3);
});

test('permission failures are reported immediately', async () => {
  const error = Object.assign(new Error('ps denied'), { code: 'EPERM' });
  vi.mocked(execFileSync).mockImplementation(() => { throw error; });
  await expect(browserProcessInventory()).rejects.toBe(error);
  expect(execFileSync).toHaveBeenCalledOnce();
  expect(setTimeout).not.toHaveBeenCalled();
});
