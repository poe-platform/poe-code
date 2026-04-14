import { access, readdir } from 'node:fs/promises';
import type { ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { vol } from 'memfs';
import { getApiKey } from './credentials.js';
import { startProxyServer } from './proxy-server.js';

vi.mock('node:fs/promises', async () => {
  const { fs } = await import('memfs');
  return fs.promises;
});

vi.mock('node:os', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:os')>();
  return {
    ...original,
    tmpdir: vi.fn(() => '/tmp'),
  };
});

vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
  spawnSync: vi.fn(),
}));

vi.mock('./credentials.js', () => ({
  getApiKey: vi.fn(async () => 'test-api-key'),
}));

vi.mock('./proxy-server.js', () => ({
  startProxyServer: vi.fn(),
}));

vi.mock('./container.js', () => ({
  getWorkspaceDir: vi.fn(() => '/workspace'),
}));

function createMockChildProcess(
  exitCode: number,
  stdoutData: string,
  stderrData: string,
): ChildProcess {
  const child = new EventEmitter() as EventEmitter & {
    stdout: PassThrough;
    stderr: PassThrough;
  };
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();

  process.nextTick(() => {
    if (stdoutData.length > 0) {
      child.stdout.write(Buffer.from(stdoutData));
    }
    if (stderrData.length > 0) {
      child.stderr.write(Buffer.from(stderrData));
    }
    child.stdout.end();
    child.stderr.end();
    child.emit('close', exitCode);
  });

  return child as unknown as ChildProcess;
}

describe('createEnvContainer', () => {
  const originalPath = process.env.PATH;

  beforeEach(() => {
    vi.clearAllMocks();
    vol.reset();
    vol.mkdirSync('/tmp', { recursive: true });
    vol.mkdirSync('/workspace/node_modules/.bin', { recursive: true });
    process.env.PATH = '/usr/bin:/bin';
  });

  afterEach(() => {
    if (originalPath === undefined) {
      delete process.env.PATH;
    } else {
      process.env.PATH = originalPath;
    }
  });

  it('creates a fresh empty home directory', async () => {
    const { createEnvContainer } = await import('./env-container.js');

    const container = await createEnvContainer();

    expect(container.home).toMatch(/^\/tmp\/poe-e2e-/);
    await expect(readdir(container.home)).resolves.toEqual([]);
  });

  it('spawns commands with sandbox env vars', async () => {
    const { spawn, spawnSync } = await import('node:child_process');
    vi.mocked(spawnSync).mockReturnValue({
      status: 0,
      stdout: 'ok\n',
      stderr: '',
      pid: 1,
      output: [],
      signal: null,
    });
    vi.mocked(spawn).mockReturnValue(
      createMockChildProcess(0, 'hello\n', ''),
    );

    const { createEnvContainer } = await import('./env-container.js');
    const container = await createEnvContainer();

    const result = await container.exec('echo hello');

    expect(result).toEqual({
      exitCode: 0,
      stdout: 'hello',
      stderr: '',
      command: 'echo hello',
    });
    expect(spawnSync).toHaveBeenCalledTimes(3);
    expect(spawn).toHaveBeenCalledTimes(1);
    expect(vi.mocked(spawn).mock.calls[0]).toEqual([
      'sh',
      ['-c', 'echo hello'],
      expect.objectContaining({
        cwd: '/workspace',
        env: expect.objectContaining({
          HOME: container.home,
          XDG_CONFIG_HOME: `${container.home}/.config`,
          NPM_CONFIG_PREFIX: `${container.home}/.npm-global`,
          PATH: `${container.home}/.local/bin:${container.home}/.npm-global/bin:/workspace/node_modules/.bin:/usr/bin:/bin`,
          POE_API_KEY: 'test-api-key',
        }),
        stdio: ['ignore', 'pipe', 'pipe'],
      }),
    ]);
  });

  it('reads and writes files inside the sandbox home', async () => {
    const { createEnvContainer } = await import('./env-container.js');
    const container = await createEnvContainer();
    const filePath = `${container.home}/notes.txt`;

    await container.writeFile(filePath, 'hello sandbox');

    await expect(container.fileExists(filePath)).resolves.toBe(true);
    await expect(container.readFile(filePath)).resolves.toBe('hello sandbox');
  });

  it('destroys the temp home directory', async () => {
    const { createEnvContainer } = await import('./env-container.js');
    const container = await createEnvContainer();
    const { home } = container;

    await container.destroy();

    await expect(access(home)).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('defers API key preflight until first exec', async () => {
    const { spawnSync } = await import('node:child_process');
    vi.mocked(getApiKey).mockResolvedValueOnce(null);
    vi.mocked(spawnSync).mockReturnValue({
      status: 0,
      stdout: 'ok\n',
      stderr: '',
      pid: 1,
      output: [],
      signal: null,
    });

    const { createEnvContainer } = await import('./env-container.js');
    const container = await createEnvContainer();

    await expect(container.exec('echo hello')).rejects.toThrow(
      'No API key available. Set POE_API_KEY environment variable.',
    );
    expect(spawnSync).not.toHaveBeenCalled();
  });

  it('allows destroy() to be called twice after proxy startup', async () => {
    const { spawn, spawnSync } = await import('node:child_process');
    vi.mocked(spawnSync).mockReturnValue({
      status: 0,
      stdout: 'ok\n',
      stderr: '',
      pid: 1,
      output: [],
      signal: null,
    });
    vi.mocked(spawn).mockReturnValue(createMockChildProcess(0, '', ''));

    let closed = false;
    vi.mocked(startProxyServer).mockResolvedValue({
      url: 'http://127.0.0.1:3456',
      close: vi.fn(async () => {
        if (closed) {
          throw new Error('proxy already closed');
        }
        closed = true;
      }),
    });

    const { createEnvContainer } = await import('./env-container.js');
    const container = await createEnvContainer({
      testName: 'double-destroy',
      useSnapshots: true,
    });

    await container.exec('echo hello');
    await expect(container.destroy()).resolves.toBeUndefined();
    await expect(container.destroy()).resolves.toBeUndefined();
  });
});
