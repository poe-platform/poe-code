import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('node:child_process', () => ({
  execSync: vi.fn(),
}));

vi.mock('node:fs', () => ({
  rmSync: vi.fn(),
}));

vi.mock('./engine.js', () => ({
  detectEngine: vi.fn(),
}));

vi.mock('./preflight.js', () => ({
  cleanupOrphans: vi.fn(),
}));

vi.mock('./runtime.js', () => ({
  E2E_CACHE_ROOT: '/tmp/poe-e2e-cache',
}));

describe('cleanupDisk', () => {
  beforeEach(async () => {
    vi.resetAllMocks();

    const { detectEngine } = await import('./engine.js');
    const { cleanupOrphans } = await import('./preflight.js');
    const { execSync } = await import('node:child_process');

    vi.mocked(detectEngine).mockReturnValue('podman');
    vi.mocked(cleanupOrphans).mockResolvedValue(2);
    vi.mocked(execSync).mockImplementation((command: string) => {
      if (command.includes(' images --format ')) {
        return 'poe-code-e2e:one\npoe-code-e2e:two\n';
      }
      return '';
    });
  });

  it('cleans e2e containers, images and local cache by default', async () => {
    const { execSync } = await import('node:child_process');
    const { rmSync } = await import('node:fs');
    const { cleanupDisk } = await import('./cleanup.js');

    const result = await cleanupDisk();

    expect(result).toEqual({
      orphanedContainers: 2,
      removedE2eImages: 2,
      localCacheCleared: true,
      aggressive: false,
    });

    const calls = vi.mocked(execSync).mock.calls.map(([command]) => command);
    expect(calls).toContain(
      'podman images --format "{{.Repository}}:{{.Tag}}" poe-code-e2e',
    );
    expect(calls).toContain('podman rmi poe-code-e2e:one');
    expect(calls).toContain('podman rmi poe-code-e2e:two');
    expect(calls).toContain('podman image prune -f');
    expect(calls).toContain('podman builder prune -f');

    expect(vi.mocked(rmSync)).toHaveBeenCalledWith('/tmp/poe-e2e-cache', {
      recursive: true,
      force: true,
    });
  });

  it('runs aggressive pruning when requested', async () => {
    const { execSync } = await import('node:child_process');
    const { cleanupDisk } = await import('./cleanup.js');

    await cleanupDisk({ aggressive: true });

    const calls = vi.mocked(execSync).mock.calls.map(([command]) => command);
    expect(calls).toContain('podman image prune -af');
    expect(calls).toContain('podman builder prune -af');
    expect(calls).toContain('podman volume prune -f');
  });

  it('supports skipping local cache cleanup', async () => {
    const { rmSync } = await import('node:fs');
    const { cleanupDisk } = await import('./cleanup.js');

    const result = await cleanupDisk({ clearLocalCache: false });

    expect(result.localCacheCleared).toBe(false);
    expect(vi.mocked(rmSync)).not.toHaveBeenCalled();
  });

  it('handles image listing failures and continues cleanup', async () => {
    const { execSync } = await import('node:child_process');
    vi.mocked(execSync).mockImplementation((command: string) => {
      if (command.includes(' images --format ')) {
        throw new Error('podman unavailable');
      }
      return '';
    });

    const { cleanupDisk } = await import('./cleanup.js');
    const result = await cleanupDisk();

    expect(result.removedE2eImages).toBe(0);
    const calls = vi.mocked(execSync).mock.calls.map(([command]) => command);
    expect(calls).toContain('podman image prune -f');
    expect(calls).toContain('podman builder prune -f');
  });
});
