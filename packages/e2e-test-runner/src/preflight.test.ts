import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('node:child_process', () => ({
  execSync: vi.fn(),
}));

vi.mock('./backend.js', () => ({
  resolveBackend: vi.fn(),
}));

vi.mock('./engine.js', () => ({
  detectEngine: vi.fn(),
}));

vi.mock('./credentials.js', () => ({
  hasApiKey: vi.fn(),
}));

describe('runPreflight', () => {
  const originalPlatform = process.platform;

  beforeEach(() => {
    vi.resetAllMocks();
    vi.resetModules();
  });

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform });
  });

  async function setup() {
    const { execSync } = await import('node:child_process');
    const { resolveBackend } = await import('./backend.js');
    const { detectEngine } = await import('./engine.js');
    const { hasApiKey } = await import('./credentials.js');
    const { runPreflight } = await import('./preflight.js');

    vi.mocked(resolveBackend).mockReturnValue('sandbox');
    vi.mocked(detectEngine).mockReturnValue('podman');
    vi.mocked(hasApiKey).mockResolvedValue(true);
    vi.mocked(execSync).mockImplementation(() => '');

    return {
      execSync: vi.mocked(execSync),
      resolveBackend: vi.mocked(resolveBackend),
      detectEngine: vi.mocked(detectEngine),
      hasApiKey: vi.mocked(hasApiKey),
      runPreflight,
    };
  }

  it('checks only API key for env backend', async () => {
    const { execSync, resolveBackend, runPreflight } = await setup();
    resolveBackend.mockReturnValue('env');

    const result = await runPreflight();

    expect(result.passed).toBe(true);
    expect(result.results).toEqual([
      expect.objectContaining({ name: 'API key available', passed: true }),
    ]);
    expect(execSync).not.toHaveBeenCalled();
  });

  it('checks sandbox tool availability on macOS sandbox backend', async () => {
    Object.defineProperty(process, 'platform', { value: 'darwin' });
    const { execSync, resolveBackend, runPreflight } = await setup();
    resolveBackend.mockReturnValue('sandbox');

    const result = await runPreflight();

    expect(result.passed).toBe(true);
    expect(execSync).toHaveBeenCalledWith('sandbox-exec -V', { stdio: 'ignore' });
    expect(result.results).toContainEqual(
      expect.objectContaining({ name: 'Sandbox runtime available', passed: true }),
    );
  });

  it('checks bubblewrap availability on Linux sandbox backend', async () => {
    Object.defineProperty(process, 'platform', { value: 'linux' });
    const { execSync, resolveBackend, runPreflight } = await setup();
    resolveBackend.mockReturnValue('sandbox');

    const result = await runPreflight();

    expect(result.passed).toBe(true);
    expect(execSync).toHaveBeenCalledWith('bwrap --version', { stdio: 'ignore' });
    expect(result.results).toContainEqual(
      expect.objectContaining({ name: 'Sandbox runtime available', passed: true }),
    );
  });

  it('fails sandbox backend when required sandbox runtime is missing', async () => {
    Object.defineProperty(process, 'platform', { value: 'linux' });
    const { execSync, resolveBackend, runPreflight } = await setup();
    resolveBackend.mockReturnValue('sandbox');
    execSync.mockImplementation((command: string) => {
      if (command === 'bwrap --version') {
        throw new Error('missing');
      }
      return '';
    });

    const result = await runPreflight();

    expect(result.passed).toBe(false);
    expect(result.results).toContainEqual(
      expect.objectContaining({
        name: 'Sandbox runtime available',
        passed: false,
      }),
    );
  });

  it('checks podman installation, daemon, and cleans orphans for podman backend', async () => {
    const { execSync, resolveBackend, detectEngine, runPreflight } = await setup();
    resolveBackend.mockReturnValue('podman');
    detectEngine.mockReturnValue('podman');
    execSync.mockImplementation((command: string) => {
      if (command === 'podman info') {
        return 'ok';
      }
      if (command === 'podman ps -aq --filter label=poe-e2e-test-runner=true') {
        return 'one\ntwo\n';
      }
      return '';
    });

    const result = await runPreflight();

    expect(result.passed).toBe(true);
    expect(result.results).toContainEqual(
      expect.objectContaining({ name: 'Podman installed', passed: true }),
    );
    expect(result.results).toContainEqual(
      expect.objectContaining({ name: 'Podman daemon running', passed: true }),
    );
    expect(result.results).toContainEqual(
      expect.objectContaining({
        name: 'Cleanup',
        passed: true,
        message: 'Cleaned up 2 orphaned container(s)',
      }),
    );
    expect(execSync).toHaveBeenCalledWith('podman info', { stdio: 'ignore' });
    expect(execSync).toHaveBeenCalledWith(
      'podman ps -aq --filter label=poe-e2e-test-runner=true',
      { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'] },
    );
  });

  it('fails fast when podman is unavailable', async () => {
    const { detectEngine, resolveBackend, runPreflight } = await setup();
    resolveBackend.mockReturnValue('podman');
    detectEngine.mockImplementation(() => {
      throw new Error('Podman not installed');
    });

    const result = await runPreflight();

    expect(result.passed).toBe(false);
    expect(result.results).toEqual([
      expect.objectContaining({
        name: 'Podman installed',
        passed: false,
        message: 'Podman not installed',
      }),
    ]);
  });

  it('fails fast when podman daemon is not running', async () => {
    const { execSync, resolveBackend, runPreflight } = await setup();
    resolveBackend.mockReturnValue('podman');
    execSync.mockImplementation((command: string) => {
      if (command === 'podman info') {
        throw new Error('not running');
      }
      return '';
    });

    const result = await runPreflight();

    expect(result.passed).toBe(false);
    expect(result.results).toContainEqual(
      expect.objectContaining({
        name: 'Podman daemon running',
        passed: false,
      }),
    );
  });

  it('fails fast when API key is missing', async () => {
    const { hasApiKey, runPreflight } = await setup();
    hasApiKey.mockResolvedValue(false);

    const result = await runPreflight();

    expect(result.passed).toBe(false);
    expect(result.results).toContainEqual(
      expect.objectContaining({ name: 'API key available', passed: false }),
    );
  });
});
