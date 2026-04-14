import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CapturedRequests, Container } from './types.js';

vi.mock('./persistent-container.js', () => ({
  createPersistentContainer: vi.fn(),
}));

import { createPersistentContainer } from './persistent-container.js';
import { createBackendContainer, resolveBackend } from './backend.js';

function makeMockContainer(): Container {
  return {
    id: 'test-123',
    home: '/home/mock',
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

  it('respects E2E_BACKEND override', () => {
    process.env.E2E_BACKEND = 'podman';
    process.env.CI = 'true';

    expect(resolveBackend()).toBe('podman');
  });

  it('throws for unsupported E2E_BACKEND override', () => {
    process.env.E2E_BACKEND = 'invalid';

    expect(() => resolveBackend()).toThrow('Unsupported E2E_BACKEND: invalid');
  });

  it("delegates docker backend to the persistent container", async () => {
    const container = makeMockContainer();
    vi.mocked(createPersistentContainer).mockResolvedValue(container);
    const options = {
      testName: 'docker-backend',
      useSnapshots: true,
    };

    const result = await createBackendContainer('docker', options);

    expect(createPersistentContainer).toHaveBeenCalledWith(options);
    expect(result).toBe(container);
  });

  it("delegates podman backend to the persistent container", async () => {
    const container = makeMockContainer();
    vi.mocked(createPersistentContainer).mockResolvedValue(container);
    const options = {
      testName: 'podman-backend',
    };

    const result = await createBackendContainer('podman', options);

    expect(createPersistentContainer).toHaveBeenCalledWith(options);
    expect(result).toBe(container);
  });

  it.each([
    ['env'],
    ['sandbox'],
  ] as const)('throws for %s backend until implemented', async (backend) => {
    await expect(createBackendContainer(backend, {})).rejects.toThrow(
      `${backend} backend not implemented yet`,
    );
    expect(createPersistentContainer).not.toHaveBeenCalled();
  });
});
