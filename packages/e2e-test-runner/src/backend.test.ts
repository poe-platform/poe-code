import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CapturedRequests, Container } from './types.js';

vi.mock('node:child_process', () => ({
  execSync: vi.fn(),
}));

vi.mock('./persistent-container.js', () => ({
  createPersistentContainer: vi.fn(),
}));

vi.mock('./env-container.js', () => ({
  createEnvContainer: vi.fn(),
}));

vi.mock('./sandbox-container.js', () => ({
  createSandboxContainer: vi.fn(),
}));

import { createPersistentContainer } from './persistent-container.js';
import { createEnvContainer } from './env-container.js';
import { createSandboxContainer } from './sandbox-container.js';
import { execSync } from 'node:child_process';
import { createBackendContainer, resolveBackend } from './backend.js';

function makeMockContainer(): Container {
  return {
    id: 'test-123',
    home: '/home/mock',
    workspace: '/home/mock/workspace',
    destroy: vi.fn(),
    exec: vi.fn().mockResolvedValue({ exitCode: 0, stdout: '', stderr: '' }),
    execOrThrow: vi.fn().mockResolvedValue({ exitCode: 0, stdout: '', stderr: '' }),
    login: vi.fn(),
    fileExists: vi.fn(),
    readFile: vi.fn(),
    writeFile: vi.fn(),
    proxyLog: vi.fn().mockResolvedValue(null),
    requests: vi.fn().mockResolvedValue({ length: 0 } as CapturedRequests),
    writeSnapshots: vi.fn().mockResolvedValue(undefined),
  };
}

describe('backend', () => {
  const originalCi = process.env.CI;
  const originalBackend = process.env.E2E_BACKEND;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(execSync).mockImplementation(() => Buffer.from(''));
    delete process.env.CI;
    delete process.env.E2E_BACKEND;
  });

  afterEach(() => {
    if (originalCi === undefined) {
      delete process.env.CI;
    } else {
      process.env.CI = originalCi;
    }

    if (originalBackend === undefined) {
      delete process.env.E2E_BACKEND;
    } else {
      process.env.E2E_BACKEND = originalBackend;
    }
  });

  it("returns 'env' when CI=true", () => {
    process.env.CI = 'true';

    expect(resolveBackend()).toBe('env');
  });

  it("returns 'sandbox' when no env vars are set", () => {
    expect(resolveBackend()).toBe('sandbox');
  });

  it("returns 'env' when sandbox runtime is unavailable locally", () => {
    vi.mocked(execSync).mockImplementation(() => {
      throw new Error('missing sandbox runtime');
    });

    expect(resolveBackend()).toBe('env');
  });

  it('respects E2E_BACKEND override', () => {
    process.env.E2E_BACKEND = 'podman';
    process.env.CI = 'true';

    expect(resolveBackend()).toBe('podman');
  });

  it('throws for unsupported E2E_BACKEND override', () => {
    process.env.E2E_BACKEND = 'docker';

    expect(() => resolveBackend()).toThrow('Unsupported E2E_BACKEND: docker');
  });

  it('delegates podman backend to the persistent container', async () => {
    const container = makeMockContainer();
    vi.mocked(createPersistentContainer).mockResolvedValue(container);
    const options = {
      testName: 'podman-backend',
      useSnapshots: true,
    };

    const result = await createBackendContainer('podman', options);

    expect(createPersistentContainer).toHaveBeenCalledWith(options);
    expect(result).toBe(container);
  });

  it('delegates env backend to the env container', async () => {
    const container = makeMockContainer();
    vi.mocked(createEnvContainer).mockResolvedValue(container);
    const options = {
      testName: 'env-backend',
      useSnapshots: true,
    };

    const result = await createBackendContainer('env', options);

    expect(createEnvContainer).toHaveBeenCalledWith(options);
    expect(result).toBe(container);
  });

  it('delegates sandbox backend to the sandbox container', async () => {
    const container = makeMockContainer();
    vi.mocked(createSandboxContainer).mockResolvedValue(container);
    const options = {
      testName: 'sandbox-backend',
      useSnapshots: true,
    };

    const result = await createBackendContainer('sandbox', options);

    expect(createSandboxContainer).toHaveBeenCalledWith(options);
    expect(result).toBe(container);
    expect(createPersistentContainer).not.toHaveBeenCalled();
    expect(createEnvContainer).not.toHaveBeenCalled();
  });
});
