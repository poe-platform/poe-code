import { describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ shellOptions: undefined as unknown, execution: undefined as unknown, python: undefined as unknown, agent: undefined as unknown, disposed: false, pandoc: undefined as unknown }));
vi.mock('poe-code/safe-bash', () => ({
  Shell: class { constructor(options: unknown) { state.shellOptions = options; } use() { return this; } async exec(source: string, options: unknown) { state.execution = { source, options }; return { exitCode: 17 }; } async dispose() { state.disposed = true; } },
  RealFileSystem: class { constructor(public options: unknown) {} },
  agentCommands: (options: unknown) => { state.agent = options; return {}; },
  pythonCommands: (options: unknown) => { state.python = options; return {}; }
}));
vi.mock('poe-code/safe-bash/commands/python/node', () => ({ createNodePythonWorker: vi.fn() }));
vi.mock('poe-code/safe-bash/commands/pandoc', () => ({ pandocCommands: vi.fn(options => { state.pandoc = options; return {}; }) }));
import { runBash } from './bash.js';

describe('runBash SDK', () => {
  it('forwards filesystem, execution and Python options, then disposes the shell', async () => {
    const fs = {} as never;
    const onProgress = vi.fn();
    const result = await runBash({ source: 'python -V', fs, cwd: '/work', env: { A: 'b' }, stdin: 'input', python: { runtimeModuleURL: 'file:///runtime.mjs', trustedPython: true, indexURL: '/assets/', runtimeMount: '/runtime', maxTransferBytes: 1024, maxOpenFiles: 5, onProgress } });
    expect(result.exitCode).toBe(17);
    expect(state.shellOptions).toEqual({ fs, cwd: '/work', env: { A: 'b' } });
    expect(state.execution).toMatchObject({ source: 'python -V', options: { stdin: 'input' } });
    expect(state.python).toMatchObject({ runtimeMount: '/runtime', maxTransferBytes: 1024, maxOpenFiles: 5, onProgress });
    expect((state.python as { createWorker: unknown }).createWorker).toBeTypeOf('function');
    expect(state.disposed).toBe(true);
  });
  it('requires an explicit filesystem or host root', async () => {
    await expect(runBash({ source: ':' })).rejects.toThrow('filesystem or root');
  });
});

it('forwards explicit archive capabilities without calling them at SDK startup', async () => {
  const entropy = vi.fn();
  const password = vi.fn();
  const archive = { zipHost: { entropy, password } };
  await runBash({ source: ':', fs: {} as never, archive });
  expect(state.agent).toEqual({ archive });
  expect(entropy).not.toHaveBeenCalled();
  expect(password).not.toHaveBeenCalled();
});

it('preserves borrowed streams and cancellation with an injected worker factory', async () => {
  const controller = new AbortController();
  const stdout = { write: vi.fn() };
  const stderr = { write: vi.fn() };
  const stdin = new Uint8Array([0, 255]);
  const createWorker = vi.fn();
  await runBash({ source: 'python -', fs: {} as never, stdin, stdout, stderr, signal: controller.signal, python: { createWorker } });
  const execution = state.execution as { options: Record<string, unknown> };
  expect(execution.options.stdin).toBe(stdin);
  expect(execution.options.stdout).toBe(stdout);
  expect(execution.options.stderr).toBe(stderr);
  expect(execution.options.signal).toBe(controller.signal);
  expect((state.python as { createWorker: unknown }).createWorker).toBe(createWorker);
  expect(createWorker).not.toHaveBeenCalled();
});

it('preserves package environment and transport configuration without provisioning at SDK startup', async () => {
  const packages = ['pypdf==6.18.1'];
  const provisioning = { offline: true, authorize: vi.fn(), transport: vi.fn() };
  const createWorker = vi.fn();
  await runBash({ source: 'echo ready', fs: {} as never, python: { createWorker, packages, provisioning } });
  expect((state.python as { packages: unknown }).packages).toBe(packages);
  expect(createWorker).not.toHaveBeenCalled();
  expect((state.python as { provisioning: unknown }).provisioning).toBe(provisioning);
  expect(provisioning.authorize).not.toHaveBeenCalled();
  expect(provisioning.transport).not.toHaveBeenCalled();
});

it('borrows the same host package environment across fresh SDK shells', async () => {
  const environment = { prepare: vi.fn(), dispatch: vi.fn(), finish: vi.fn(), dispose: vi.fn() };
  const createWorker = vi.fn();
  for (const source of ['echo ready', 'python -c pass']) {
    await runBash({ source, fs: {} as never, python: { createWorker, environment } });
    expect((state.python as { environment: unknown }).environment).toBe(environment);
  }
  expect(environment.prepare).not.toHaveBeenCalled();
  expect(environment.dispose).not.toHaveBeenCalled();
  expect(createWorker).not.toHaveBeenCalled();
});

it('forwards explicit trusted Python admission to the Node worker', async () => {
  const { createNodePythonWorker } = await import('poe-code/safe-bash/commands/python/node');
  await runBash({ source: 'python -V', fs: {} as never, python: { runtimeModuleURL: 'file:///runtime.mjs', trustedPython: true } });
  (state.python as { createWorker: () => unknown }).createWorker();
  expect(createNodePythonWorker).toHaveBeenCalledWith(expect.objectContaining({ trustedPython: true }));
});

it('registers Pandoc only on explicit opt-in and forwards lowerable limits', async () => {
  const { pandocCommands } = await import('poe-code/safe-bash/commands/pandoc');
  vi.mocked(pandocCommands).mockClear();
  await runBash({ source: 'pandoc --help', fs: {} as never });
  expect(pandocCommands).not.toHaveBeenCalled();
  await runBash({ source: 'pandoc --help', fs: {} as never, pandoc: { limits: { inputBytes: 1024 } } });
  expect(pandocCommands).toHaveBeenCalledWith({ limits: { inputBytes: 1024 } });
  expect(state.disposed).toBe(true);
});
