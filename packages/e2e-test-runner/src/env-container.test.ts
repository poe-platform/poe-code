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

vi.mock('./runtime.js', () => ({
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

async function withObjectPrototypeCode<T>(code: string, callback: () => Promise<T>): Promise<T> {
  const descriptor = Object.getOwnPropertyDescriptor(Object.prototype, 'code');
  Object.defineProperty(Object.prototype, 'code', {
    configurable: true,
    value: code,
  });

  try {
    return await callback();
  } finally {
    if (descriptor) {
      Object.defineProperty(Object.prototype, 'code', descriptor);
    } else {
      delete (Object.prototype as { code?: unknown }).code;
    }
  }
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
    await expect(readdir(container.home)).resolves.toEqual(['workspace']);
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
      stdout: 'hello\n',
      stderr: '',
      command: 'echo hello',
    });
    expect(spawnSync).toHaveBeenCalledTimes(3);
    expect(spawn).toHaveBeenCalledTimes(1);
    expect(vi.mocked(spawn).mock.calls[0]).toEqual([
      'sh',
      ['-c', 'echo hello'],
      expect.objectContaining({
        cwd: `${container.home}/workspace`,
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

  it('preserves command stdout and stderr exactly', async () => {
    const { spawn, spawnSync } = await import('node:child_process');
    vi.mocked(spawnSync).mockReturnValue({
      status: 0,
      stdout: 'ok\n',
      stderr: '',
      pid: 1,
      output: [],
      signal: null,
    });
    vi.mocked(spawn).mockImplementation(
      () => createMockChildProcess(0, '  leading stdout  \n\n', '  leading stderr  \n\n'),
    );

    const { createEnvContainer } = await import('./env-container.js');
    const container = await createEnvContainer();

    await expect(container.exec('printf whitespace')).resolves.toEqual({
      exitCode: 0,
      stdout: '  leading stdout  \n\n',
      stderr: '  leading stderr  \n\n',
      command: 'printf whitespace',
    });
  });

  it('rejects package bin names that escape the isolated local bin directory', async () => {
    vol.writeFileSync('/workspace/package.json', JSON.stringify({ bin: { '../created-link': 'bin/tool' } }));
    vol.mkdirSync('/workspace/bin', { recursive: true });
    vol.writeFileSync('/workspace/bin/tool', '#!/bin/sh\n');
    const { spawn, spawnSync } = await import('node:child_process');
    vi.mocked(spawnSync).mockReturnValue({ status: 0, stdout: 'ok\n', stderr: '', pid: 1, output: [], signal: null });
    vi.mocked(spawn).mockReturnValue(createMockChildProcess(0, '', ''));
    const { createEnvContainer } = await import('./env-container.js');
    const container = await createEnvContainer();

    await expect(container.exec('true')).rejects.toThrow('Invalid package bin name');
  });

  it('rejects package bin targets outside the workspace', async () => {
    vol.writeFileSync('/workspace/package.json', JSON.stringify({ bin: { tool: '../outside-tool' } }));
    vol.writeFileSync('/outside-tool', 'external');
    const { spawn, spawnSync } = await import('node:child_process');
    vi.mocked(spawnSync).mockReturnValue({ status: 0, stdout: 'ok\n', stderr: '', pid: 1, output: [], signal: null });
    vi.mocked(spawn).mockReturnValue(createMockChildProcess(0, '', ''));
    const { createEnvContainer } = await import('./env-container.js');
    const container = await createEnvContainer();

    await expect(container.exec('true')).rejects.toThrow('outside the workspace');
  });

  it('rejects package bin targets that are symbolic links', async () => {
    vol.writeFileSync('/workspace/package.json', JSON.stringify({ bin: { tool: 'bin/tool' } }));
    vol.mkdirSync('/workspace/bin', { recursive: true });
    vol.writeFileSync('/outside-tool', 'external');
    vol.symlinkSync('/outside-tool', '/workspace/bin/tool');
    const { spawn, spawnSync } = await import('node:child_process');
    vi.mocked(spawnSync).mockReturnValue({ status: 0, stdout: 'ok\n', stderr: '', pid: 1, output: [], signal: null });
    vi.mocked(spawn).mockReturnValue(createMockChildProcess(0, '', ''));
    const { createEnvContainer } = await import('./env-container.js');
    const container = await createEnvContainer();

    await expect(container.exec('true')).rejects.toThrow('symbolic link');
  });

  it('rejects snapshot test names that escape the fixture directory', async () => {
    const { createEnvContainer } = await import('./env-container.js');

    await expect(createEnvContainer({ testName: '../../outside', useSnapshots: true }))
      .rejects.toThrow('Invalid snapshot test name');
  });

  it('rejects symlinked snapshot directories before playback or recording', async () => {
    vol.mkdirSync('/workspace/.snapshots', { recursive: true });
    vol.mkdirSync('/outside', { recursive: true });
    vol.symlinkSync('/outside', '/workspace/.snapshots/proxy');
    const { createEnvContainer } = await import('./env-container.js');

    await expect(createEnvContainer({ testName: 'proxy', useSnapshots: true }))
      .rejects.toThrow('symbolic link');
  });

  it('rejects a symlinked snapshots root before playback or recording', async () => {
    vol.mkdirSync('/outside', { recursive: true });
    vol.symlinkSync('/outside', '/workspace/.snapshots');
    const { createEnvContainer } = await import('./env-container.js');

    await expect(createEnvContainer({ testName: 'proxy', useSnapshots: true }))
      .rejects.toThrow('symbolic link');
    expect(vol.existsSync('/outside/proxy')).toBe(false);
  });

  it('reads and writes files inside the sandbox home', async () => {
    const { createEnvContainer } = await import('./env-container.js');
    const container = await createEnvContainer();
    const filePath = `${container.home}/notes.txt`;

    await container.writeFile(filePath, 'hello sandbox');

    await expect(container.fileExists(filePath)).resolves.toBe(true);
    await expect(container.readFile(filePath)).resolves.toBe('hello sandbox');
  });

  it('rejects file helper paths outside the sandbox home and workspace', async () => {
    const { createEnvContainer } = await import('./env-container.js');
    const container = await createEnvContainer();
    const outsideFile = '/tmp/outside.txt';

    await expect(container.writeFile(outsideFile, 'outside')).rejects.toThrow(
      'outside the e2e container',
    );
    await expect(container.readFile(outsideFile)).rejects.toThrow(
      'outside the e2e container',
    );
    await expect(container.fileExists(outsideFile)).rejects.toThrow(
      'outside the e2e container',
    );
    expect(vol.existsSync(outsideFile)).toBe(false);
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

  it('retries destroy when recursive removal hits ENOTEMPTY', async () => {
    const fsPromises = await import('node:fs/promises');
    const originalRm = fsPromises.rm.bind(fsPromises);
    const rmSpy = vi.spyOn(fsPromises, 'rm');
    rmSpy
      .mockRejectedValueOnce(
        Object.assign(new Error('directory not empty'), { code: 'ENOTEMPTY' }),
      )
      .mockImplementation(originalRm);

    const { createEnvContainer } = await import('./env-container.js');
    const container = await createEnvContainer();
    const { home } = container;

    await expect(container.destroy()).resolves.toBeUndefined();

    expect(rmSpy).toHaveBeenCalledTimes(2);
    await expect(access(home)).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('does not retry destroy errors that only inherit retryable codes', async () => {
    const fsPromises = await import('node:fs/promises');
    const removeError = new Error('plain remove failure');
    const rmSpy = vi.spyOn(fsPromises, 'rm').mockRejectedValueOnce(removeError);

    const { createEnvContainer } = await import('./env-container.js');
    const container = await createEnvContainer();

    await withObjectPrototypeCode('ENOTEMPTY', async () => {
      await expect(container.destroy()).rejects.toBe(removeError);
    });

    expect(rmSpy).toHaveBeenCalledOnce();
  });

  it('rejects snapshot lstat failures that only inherit missing-path codes', async () => {
    const fsPromises = await import('node:fs/promises');
    const lstatError = new Error('lstat failed');
    vi.spyOn(fsPromises, 'lstat').mockRejectedValueOnce(lstatError);

    const { createEnvContainer } = await import('./env-container.js');

    await withObjectPrototypeCode('ENOENT', async () => {
      await expect(createEnvContainer({ testName: 'proxy', useSnapshots: true }))
        .rejects.toBe(lstatError);
    });
  });

  it('rejects fresh-home preflight failures that only inherit missing-path codes', async () => {
    const { spawnSync } = await import('node:child_process');
    const fsPromises = await import('node:fs/promises');
    const accessError = new Error('access failed');
    vi.spyOn(fsPromises, 'access').mockRejectedValueOnce(accessError);
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

    await withObjectPrototypeCode('ENOENT', async () => {
      await expect(container.exec('echo hello')).rejects.toBe(accessError);
    });
    expect(spawnSync).not.toHaveBeenCalled();
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

  it('retries proxy close when the first destroy attempt fails', async () => {
    const { spawn, spawnSync } = await import('node:child_process');
    vi.mocked(spawnSync).mockReturnValue({ status: 0, stdout: 'ok\n', stderr: '', pid: 1, output: [], signal: null });
    vi.mocked(spawn).mockReturnValue(createMockChildProcess(0, '', ''));
    const close = vi.fn().mockRejectedValueOnce(new Error('close failed')).mockResolvedValue(undefined);
    vi.mocked(startProxyServer).mockResolvedValue({ url: 'http://127.0.0.1:3456', close });
    const { createEnvContainer } = await import('./env-container.js');
    const container = await createEnvContainer({ testName: 'retry-close', useSnapshots: true });
    await container.exec('true');

    await expect(container.destroy()).rejects.toThrow('close failed');
    await expect(container.destroy()).resolves.toBeUndefined();
    expect(close).toHaveBeenCalledTimes(2);
  });
});
