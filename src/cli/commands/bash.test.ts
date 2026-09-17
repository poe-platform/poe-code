import { Command } from 'commander';
import { afterEach, expect, it, vi } from 'vitest';
import { runBash } from '../../sdk/bash.js';
import { registerBashCommand } from './bash.js';
vi.mock('../../sdk/bash.js', () => ({ runBash: vi.fn(async () => ({ exitCode: 0 })) }));
vi.mock('poe-code/safe-bash', async () => ({
  ...(await import('../../../packages/safe-bash/src/commands/network/authorizer.js')),
  createFetchTransport: () => vi.fn(),
}));
afterEach(() => { vi.clearAllMocks(); process.exitCode = 0; });
it('passes explicit Python configuration through the SDK', async () => {
  const program = new Command();
  registerBashCommand(program);
  await program.parseAsync(['bash', '-c', 'python -V', '--root', '/project', '--cwd', '/work', '--python-runtime', 'file:///runtime.mjs', '--python-trusted', '--python-index-url', '/assets/', '--python-runtime-mount', '/runtime', '--python-max-transfer-bytes', '1024', '--python-max-open-files', '5'], { from: 'user' });
  expect(runBash).toHaveBeenCalledWith(expect.objectContaining({ source: 'python -V', root: '/project', cwd: '/work', python: expect.objectContaining({ runtimeModuleURL: 'file:///runtime.mjs', indexURL: '/assets/', runtimeMount: '/runtime', maxTransferBytes: 1024, maxOpenFiles: 5 }) }));
});
it('does not enable Python without a runtime URL', async () => {
  const program = new Command();
  registerBashCommand(program);
  await program.parseAsync(['bash', '-c', 'echo hi'], { from: 'user' });
  expect(runBash).toHaveBeenCalledWith(expect.objectContaining({ python: undefined }));
});
it('forwards explicit Python package pins, requirements and document profile', async () => {
  const program = new Command();
  registerBashCommand(program);
  await program.parseAsync(['bash', '-c', 'python script.py', '--python-runtime', 'file:///runtime.mjs', '--python-trusted', '--python-package', 'pypdf==6.18.1', '--python-package', '/wheels/local-1.0-py3-none-any.whl', '--python-requirements', '/requirements.txt', '--python-package-profile', 'documents'], { from: 'user' });
  expect(runBash).toHaveBeenCalledWith(expect.objectContaining({ python: expect.objectContaining({
    packages: ['pypdf==6.18.1', '/wheels/local-1.0-py3-none-any.whl'], requirements: ['/requirements.txt'], packageProfile: 'documents'
  }) }));
});
it('rejects package options without a Python runtime', async () => {
  const program = new Command();
  registerBashCommand(program);
  await expect(program.parseAsync(['bash', '-c', ':', '--python-package', 'pypdf==6.18.1'], { from: 'user' })).rejects.toThrow('--python-runtime');
  expect(runBash).not.toHaveBeenCalled();
});
it('forwards offline package cache configuration', async () => {
  const program = new Command();
  registerBashCommand(program);
  await program.parseAsync(['bash', '-c', 'python -c pass', '--python-runtime', 'file:///runtime.mjs', '--python-trusted', '--python-package-cache', '/cache/python', '--python-package-offline'], { from: 'user' });
  expect(runBash).toHaveBeenCalledWith(expect.objectContaining({ python: expect.objectContaining({ provisioning: expect.objectContaining({ offline: true, cacheDirectory: '/cache/python' }) }) }));
});
it('restricts installer downloads to explicitly permitted origins', async () => {
  const program = new Command();
  registerBashCommand(program);
  await program.parseAsync(['bash', '-c', 'python -m pip install pypdf==6.18.1', '--python-runtime', 'file:///runtime.mjs', '--python-trusted', '--python-package-allow-origin', 'https://pypi.org', '--python-package-allow-origin', 'https://files.pythonhosted.org'], { from: 'user' });
  const provisioning = vi.mocked(runBash).mock.calls[0]![0].python!.provisioning!;
  expect(provisioning.transport).toBeTypeOf('function');
  const request = { method: 'GET', attempt: 0, signal: new AbortController().signal };
  expect(await provisioning.authorize!({ ...request, url: 'https://pypi.org/pypi/pypdf/json' })).toBe(true);
  expect(await provisioning.authorize!({ ...request, url: 'https://unapproved.example/wheel.whl' })).toBe(false);
});
it('reports installer download progress on stderr', async () => {
  const write = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
  vi.mocked(runBash).mockImplementationOnce(async options => {
    options.python!.provisioning!.onProgress!({ phase: 'download', url: 'https://files.example/package.whl', bytes: 1024, totalBytes: 2048 });
    options.python!.provisioning!.onProgress!({ phase: 'download', url: 'https://files.example/package.whl', bytes: 1536, totalBytes: 2048 });
    options.python!.provisioning!.onProgress!({ phase: 'download', url: 'https://files.example/package.whl', bytes: 2048, totalBytes: 2048 });
    options.python!.provisioning!.onProgress!({ phase: 'installed' });
    return { exitCode: 0 } as never;
  });
  try {
    const program = new Command();
    registerBashCommand(program);
    await program.parseAsync(['bash', '-c', 'python -c pass', '--python-runtime', 'file:///runtime.mjs', '--python-trusted'], { from: 'user' });
    expect(write).toHaveBeenCalledWith(expect.stringContaining('1024/2048 bytes'));
    expect(write).toHaveBeenCalledWith(expect.stringContaining('Python packages installed'));
    expect(write.mock.calls.filter(([text]) => String(text).includes('Python package download:'))).toHaveLength(2);
  } finally { write.mockRestore(); }
});
it('rejects Python configuration without an enabled runtime', async () => {
  const program = new Command();
  registerBashCommand(program);
  await expect(program.parseAsync(['bash', '-c', ':', '--python-max-open-files', '5'], { from: 'user' })).rejects.toThrow('--python-runtime');
  expect(runBash).not.toHaveBeenCalled();
});
it('refuses global dry-run before executing filesystem mutations', async () => {
  const program = new Command().option('--dry-run');
  registerBashCommand(program);
  await expect(program.parseAsync(['--dry-run', 'bash', '-c', 'rm file'], { from: 'user' })).rejects.toThrow('dry-run');
  expect(runBash).not.toHaveBeenCalled();
});
it('does not leak a spinner when pipeline interpreters initialize concurrently', async () => {
  vi.useFakeTimers();
  const previous = process.stderr.isTTY;
  process.stderr.isTTY = true;
  const write = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
  vi.mocked(runBash).mockImplementationOnce(async options => {
    options.python!.onProgress!({ command: 'python', phase: 'initializing' });
    options.python!.onProgress!({ command: 'python', phase: 'initializing' });
    options.python!.onProgress!({ command: 'python', phase: 'ready' });
    options.python!.onProgress!({ command: 'python', phase: 'finished' });
    return { exitCode: 0 } as never;
  });
  try {
    const program = new Command();
    registerBashCommand(program);
    await program.parseAsync(['bash', '-c', 'python -V | python -V', '--python-runtime', 'file:///runtime.mjs', '--python-trusted'], { from: 'user' });
    expect(vi.getTimerCount()).toBe(0);
  } finally { write.mockRestore(); process.stderr.isTTY = previous; vi.useRealTimers(); }
});
it.each(['stdout', 'stderr'] as const)('contains borrowed %s errors and retires its listeners after Python status selection', async destination => {
  const stream = process[destination];
  const previousListeners = stream.listenerCount('error');
  const failure = Object.assign(new Error('write EPIPE'), { code: 'EPIPE' });
  const write = vi.spyOn(stream, 'write').mockImplementation(((bytes: unknown, callback: (error?: Error) => void) => {
    callback(failure);
    stream.emit('error', failure);
    return false;
  }) as typeof process.stdout.write);
  vi.mocked(runBash).mockImplementationOnce(async options => {
    expect(stream.listenerCount('error')).toBe(previousListeners + 1);
    const pending = options[destination]!.write(new Uint8Array([120]));
    await expect(pending).rejects.toBe(failure);
    return { exitCode: 120 } as never;
  });
  try {
    const program = new Command();
    registerBashCommand(program);
    await program.parseAsync(['bash', '-c', 'python -c pass'], { from: 'user' });
    expect(process.exitCode).toBe(120);
    expect(stream.listenerCount('error')).toBe(previousListeners);
  } finally { write.mockRestore(); }
});
it('retires output error listeners when SDK execution rejects', async () => {
  const before = [process.stdout.listenerCount('error'), process.stderr.listenerCount('error')];
  vi.mocked(runBash).mockRejectedValueOnce(new Error('execution failed'));
  const program = new Command();
  registerBashCommand(program);
  await expect(program.parseAsync(['bash', '-c', ':'], { from: 'user' })).rejects.toThrow('execution failed');
  expect([process.stdout.listenerCount('error'), process.stderr.listenerCount('error')]).toEqual(before);
});

it('requires explicit trust admission for the Node Python runtime', async () => {
  const program = new Command();
  registerBashCommand(program);
  await expect(program.parseAsync(['bash', '-c', 'python -V', '--python-runtime', 'file:///runtime.mjs'], { from: 'user' })).rejects.toThrow('--python-trusted');
  expect(runBash).not.toHaveBeenCalled();
});
it('forwards Python concurrency and input retention limits with explicit trust admission', async () => {
  const program = new Command().exitOverride();
  registerBashCommand(program);
  await program.parseAsync(['bash', '-c', 'python -V', '--python-runtime', 'file:///runtime.mjs', '--python-trusted', '--python-max-concurrent-workers', '2', '--python-max-input-chunk-bytes', '4096'], { from: 'user' });
  expect(runBash).toHaveBeenCalledWith(expect.objectContaining({ python: expect.objectContaining({ trustedPython: true, maxConcurrentWorkers: 2, maxInputChunkBytes: 4096 }) }));
});

it('forwards a package cache byte bound', async () => {
  const program = new Command().exitOverride();
  registerBashCommand(program);
  await program.parseAsync(['bash', '-c', ':', '--python-runtime', 'file:///runtime.mjs', '--python-trusted', '--python-package-max-cache-bytes', '134217728'], { from: 'user' });
  expect(runBash).toHaveBeenCalledWith(expect.objectContaining({ python: expect.objectContaining({ provisioning: expect.objectContaining({ maxCacheBytes: 134217728 }) }) }));
});

it('enables the explicit Pandoc plugin through the SDK', async () => {
  const program = new Command().exitOverride();
  registerBashCommand(program);
  await program.parseAsync(['bash', '--pandoc', '-c', 'pandoc --help'], { from: 'user' });
  expect(runBash).toHaveBeenCalledWith(expect.objectContaining({ pandoc: {} }));
});
it('leaves Pandoc disabled by default', async () => {
  const program = new Command().exitOverride();
  registerBashCommand(program);
  await program.parseAsync(['bash', '-c', 'echo ready'], { from: 'user' });
  expect(runBash).toHaveBeenCalledWith(expect.objectContaining({ pandoc: undefined }));
});
