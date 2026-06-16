import { access } from 'node:fs/promises';
import type { ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { vol } from 'memfs';
import { getApiKey } from './credentials.js';
import { buildSandboxCommand } from './sandbox.js';

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

vi.mock('./runtime.js', () => ({
  getWorkspaceDir: vi.fn(() => '/workspace'),
}));

vi.mock('./sandbox.js', () => ({
  buildSandboxCommand: vi.fn((config: unknown, command: string) => ({
    bin: 'sandbox-bin',
    args: ['--wrapped', command],
  })),
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

describe('createSandboxContainer', () => {
  const originalPath = process.env.PATH;

  beforeEach(() => {
    vi.clearAllMocks();
    vol.reset();
    vol.mkdirSync('/tmp', { recursive: true });
    vol.mkdirSync('/workspace/node_modules/.bin', { recursive: true });
    process.env.PATH = '/usr/bin:/bin';
  });

  afterEach(() => {
    delete process.env.__proto__;
    if (originalPath === undefined) {
      delete process.env.PATH;
    } else {
      process.env.PATH = originalPath;
    }
  });

  it('wraps exec commands through buildSandboxCommand before spawning', async () => {
    const { spawn, spawnSync } = await import('node:child_process');
    vi.mocked(spawnSync).mockReturnValue({
      status: 0,
      stdout: 'ok\n',
      stderr: '',
      pid: 1,
      output: [],
      signal: null,
    });
    vi.mocked(spawn).mockImplementation(() => createMockChildProcess(0, 'hello\n', ''));

    const { createSandboxContainer } = await import('./sandbox-container.js');
    const container = await createSandboxContainer();

    const result = await container.exec('echo hello');

    expect(result).toEqual({
      exitCode: 0,
      stdout: 'hello\n',
      stderr: '',
      command: 'echo hello',
    });
    expect(buildSandboxCommand).toHaveBeenCalledWith(
      {
        home: container.home,
        writablePaths: [container.home, '/tmp'],
        env: expect.objectContaining({
          HOME: container.home,
          XDG_CONFIG_HOME: `${container.home}/.config`,
          NPM_CONFIG_PREFIX: `${container.home}/.npm-global`,
          PATH: `${container.home}/.local/bin:${container.home}/.npm-global/bin:/workspace/node_modules/.bin:/usr/bin:/bin`,
          POE_API_KEY: 'test-api-key',
        }),
      },
      'echo hello',
    );
    expect(spawn).toHaveBeenCalledWith(
      'sandbox-bin',
      expect.any(Array),
      expect.objectContaining({
        cwd: `${container.home}/workspace`,
        env: expect.objectContaining({
          HOME: container.home,
        }),
        stdio: ['ignore', 'pipe', 'pipe'],
      }),
    );
  });

  it('preserves ambient environment variables named __proto__', async () => {
    const { spawn, spawnSync } = await import('node:child_process');
    process.env.__proto__ = 'visible';
    vi.mocked(spawnSync).mockReturnValue({
      status: 0,
      stdout: 'ok\n',
      stderr: '',
      pid: 1,
      output: [],
      signal: null,
    });
    vi.mocked(spawn).mockImplementation(() => createMockChildProcess(0, '', ''));

    const { createSandboxContainer } = await import('./sandbox-container.js');
    const container = await createSandboxContainer();
    await container.exec('echo ok');

    const config = vi.mocked(buildSandboxCommand).mock.calls[0]![0] as { env: Record<string, string> };
    expect(Object.hasOwn(config.env, '__proto__')).toBe(true);
    expect(config.env.__proto__).toBe('visible');
  });

  it('supports the same file operations as env-container', async () => {
    const { createSandboxContainer } = await import('./sandbox-container.js');
    const container = await createSandboxContainer();
    const filePath = `${container.home}/notes.txt`;

    await container.writeFile(filePath, 'hello sandbox');

    await expect(container.fileExists(filePath)).resolves.toBe(true);
    await expect(container.readFile(filePath)).resolves.toBe('hello sandbox');

    await container.destroy();

    await expect(access(container.home)).rejects.toMatchObject({
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

    const { createSandboxContainer } = await import('./sandbox-container.js');
    const container = await createSandboxContainer();

    await expect(container.exec('echo hello')).rejects.toThrow(
      'No API key available. Set POE_API_KEY environment variable.',
    );
    expect(buildSandboxCommand).not.toHaveBeenCalled();
    expect(spawnSync).not.toHaveBeenCalled();
  });
});
