import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('node:child_process', () => ({
  execSync: vi.fn(),
}));

vi.mock('./engine.js', () => ({
  detectEngine: vi.fn(),
}));

vi.mock('./context.js', () => ({
  detectRunningContext: vi.fn(),
  setResolvedContext: vi.fn(),
  getResolvedContext: vi.fn().mockReturnValue(null),
}));

vi.mock('./credentials.js', () => ({
  hasApiKey: vi.fn(),
}));

vi.mock('./image.js', () => ({
  IMAGE_NAME: 'poe-code-e2e',
}));

describe('runPreflight - Docker Desktop auto-start', () => {
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
    const { detectEngine } = await import('./engine.js');
    const { detectRunningContext } = await import('./context.js');
    const { hasApiKey } = await import('./credentials.js');
    const { runPreflight } = await import('./preflight.js');

    vi.mocked(detectEngine).mockReturnValue('docker');
    vi.mocked(detectRunningContext).mockReturnValue(null);
    vi.mocked(hasApiKey).mockResolvedValue(true);

    return { execSync: vi.mocked(execSync), runPreflight };
  }

  function mockExecCommands(execSync: ReturnType<typeof vi.fn>, overrides: Record<string, () => string | Buffer> = {}) {
    execSync.mockImplementation((cmd: string) => {
      const cmdStr = String(cmd);

      // Exact match first, then prefix match (command without args)
      if (overrides[cmdStr]) {
        return overrides[cmdStr]();
      }
      for (const [key, handler] of Object.entries(overrides)) {
        if (cmdStr.startsWith(key + ' ')) {
          return handler();
        }
      }

      // Default: docker info always fails (daemon not running)
      if (cmdStr.includes('docker info') || cmdStr.includes('docker --context')) {
        throw new Error('Cannot connect to Docker daemon');
      }

      // Default: colima not available
      if (cmdStr === 'command -v colima') {
        throw new Error('not found');
      }

      if (cmdStr === 'colima status') {
        throw new Error('not running');
      }

      // ps for cleanup
      if (cmdStr.includes('ps -aq')) {
        return '';
      }

      return Buffer.from('');
    });
  }

  it('recovers from stale colima VM by stopping and restarting', async () => {
    Object.defineProperty(process, 'platform', { value: 'darwin' });
    const { execSync, runPreflight } = await setup();

    let colimaStartAttempts = 0;
    let colimaDeleted = false;
    mockExecCommands(execSync, {
      'command -v colima': () => 'ok',
      'colima status': () => {
        throw new Error('not running');
      },
      'colima start': () => {
        colimaStartAttempts++;
        if (colimaStartAttempts === 1) {
          throw new Error('error at starting: exit status 1');
        }
        return '';
      },
      'colima delete --force': () => {
        colimaDeleted = true;
        return '';
      },
      'scutil --dns': () => 'nameserver[0] : 192.168.1.1',
      'docker info': () => {
        if (colimaStartAttempts >= 2) return 'ok';
        throw new Error('Cannot connect to Docker daemon');
      },
    });

    const result = await runPreflight();

    expect(colimaDeleted).toBe(true);
    expect(colimaStartAttempts).toBe(2);
    expect(result.passed).toBe(true);
    expect(result.results).toContainEqual(
      expect.objectContaining({
        name: 'Docker daemon running',
        passed: true,
      }),
    );
  });

  it('starts Docker Desktop on macOS when daemon is not running and colima is unavailable', async () => {
    Object.defineProperty(process, 'platform', { value: 'darwin' });
    const { execSync, runPreflight } = await setup();

    let dockerStarted = false;
    mockExecCommands(execSync, {
      'docker info': () => {
        if (dockerStarted) return 'ok';
        throw new Error('Cannot connect to Docker daemon');
      },
      'test -d "/Applications/Docker.app"': () => 'ok',
      'open -a Docker': () => {
        dockerStarted = true;
        return '';
      },
    });

    const result = await runPreflight();

    expect(result.passed).toBe(true);
    expect(result.results).toContainEqual(
      expect.objectContaining({
        name: 'Docker daemon running',
        passed: true,
        message: 'Started Docker Desktop',
      }),
    );
  });

  it('does not try Docker Desktop on Linux', async () => {
    Object.defineProperty(process, 'platform', { value: 'linux' });
    const { execSync, runPreflight } = await setup();

    mockExecCommands(execSync);

    const result = await runPreflight();

    expect(result.passed).toBe(false);
    expect(execSync).not.toHaveBeenCalledWith('open -a Docker', expect.anything());
  });

  it('fails when Docker.app is not installed', async () => {
    Object.defineProperty(process, 'platform', { value: 'darwin' });
    const { execSync, runPreflight } = await setup();

    mockExecCommands(execSync, {
      'test -d "/Applications/Docker.app"': () => {
        throw new Error('not found');
      },
    });

    const result = await runPreflight();

    expect(result.passed).toBe(false);
    expect(execSync).not.toHaveBeenCalledWith('open -a Docker', expect.anything());
  });

  it('fails when Docker Desktop starts but daemon never becomes ready', async () => {
    Object.defineProperty(process, 'platform', { value: 'darwin' });
    const { execSync, runPreflight } = await setup();

    mockExecCommands(execSync, {
      'test -d "/Applications/Docker.app"': () => 'ok',
      'open -a Docker': () => '',
      // docker info always throws (never becomes ready)
    });

    const result = await runPreflight();

    expect(result.passed).toBe(false);
  });
});

describe('runPreflight - soft failure on missing API key', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.resetModules();
  });

  async function setup() {
    const { execSync } = await import('node:child_process');
    const { detectEngine } = await import('./engine.js');
    const { detectRunningContext } = await import('./context.js');
    const { hasApiKey } = await import('./credentials.js');
    const { runPreflight, hasCriticalFailure } = await import('./preflight.js');

    vi.mocked(detectEngine).mockReturnValue('docker');
    vi.mocked(detectRunningContext).mockReturnValue(null);

    vi.mocked(execSync).mockImplementation((cmd: string) => {
      const cmdStr = String(cmd);
      if (cmdStr.includes('docker info')) return Buffer.from('ok');
      if (cmdStr.includes('ps -aq')) return Buffer.from('');
      if (cmdStr.includes('images --format')) return Buffer.from('');
      return Buffer.from('');
    });

    return { hasApiKey: vi.mocked(hasApiKey), execSync: vi.mocked(execSync), runPreflight, hasCriticalFailure };
  }

  it('marks API key failure as non-critical', async () => {
    const { hasApiKey, runPreflight } = await setup();
    hasApiKey.mockResolvedValue(false);

    const { passed, results } = await runPreflight();

    expect(passed).toBe(false);
    const apiKeyResult = results.find(r => r.name === 'API key available');
    expect(apiKeyResult).toBeDefined();
    expect(apiKeyResult!.passed).toBe(false);
    expect(apiKeyResult!.critical).toBe(false);
  });

  it('marks Docker checks as critical by default', async () => {
    const { hasApiKey, runPreflight } = await setup();
    hasApiKey.mockResolvedValue(true);

    const { results } = await runPreflight();

    const dockerCheck = results.find(r => r.name === 'Docker installed');
    expect(dockerCheck).toBeDefined();
    expect(dockerCheck!.critical).not.toBe(false);
  });

  it('continues to cleanup even when API key is missing', async () => {
    const { hasApiKey, execSync, runPreflight } = await setup();
    hasApiKey.mockResolvedValue(false);

    await runPreflight();

    expect(execSync).toHaveBeenCalledWith(
      expect.stringContaining('ps -aq'),
      expect.anything(),
    );
  });

  it('hasCriticalFailure returns false when only non-critical checks fail', async () => {
    const { hasApiKey, runPreflight, hasCriticalFailure } = await setup();
    hasApiKey.mockResolvedValue(false);

    const { results } = await runPreflight();

    expect(hasCriticalFailure(results)).toBe(false);
  });

  it('hasCriticalFailure returns true when a critical check fails', async () => {
    const { hasCriticalFailure } = await setup();

    expect(hasCriticalFailure([
      { name: 'Docker installed', passed: false },
    ])).toBe(true);
  });

  it('hasCriticalFailure returns true for explicit critical: true', async () => {
    const { hasCriticalFailure } = await setup();

    expect(hasCriticalFailure([
      { name: 'Docker installed', passed: false, critical: true },
    ])).toBe(true);
  });

  it('hasCriticalFailure returns false for empty array', async () => {
    const { hasCriticalFailure } = await setup();

    expect(hasCriticalFailure([])).toBe(false);
  });
});
