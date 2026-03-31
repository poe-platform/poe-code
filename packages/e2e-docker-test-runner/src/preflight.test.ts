import { afterAll, afterEach, beforeEach, describe, expect, it, mock, vi } from 'bun:test';

vi.mock('node:child_process', () => ({
  execSync: vi.fn(),
  spawnSync: vi.fn(),
}));

vi.mock('./engine.js', () => ({
  detectEngine: vi.fn(),
}));

vi.mock('./context.js', () => ({
  detectRunningContext: vi.fn(),
  setResolvedContext: vi.fn(),
  getResolvedContext: vi.fn().mockReturnValue(null),
}));

describe('runPreflight - Docker Desktop auto-start', () => {
  const originalPlatform = process.platform;
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetAllMocks();
    vi.resetModules();
    process.env = { ...originalEnv, POE_API_KEY: 'test-api-key' };
  });

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform });
    process.env = originalEnv;
  });

  async function setup() {
    const { execSync, spawnSync } = await import('node:child_process');
    const { detectEngine } = await import('./engine.js');
    const { detectRunningContext, getResolvedContext } = await import('./context.js');
    const { getSourceHash } = await import('./image.js');
    const { runPreflight } = await import('./preflight.js');

    vi.mocked(detectEngine).mockReturnValue('docker');
    vi.mocked(detectRunningContext).mockReturnValue(null);
    vi.mocked(getResolvedContext).mockReturnValue(null);

    return {
      execSync: vi.mocked(execSync),
      spawnSync: vi.mocked(spawnSync),
      detectRunningContext: vi.mocked(detectRunningContext),
      getResolvedContext: vi.mocked(getResolvedContext),
      getSourceHash,
      runPreflight,
    };
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

  it('prebuilds the e2e image when a workspace is provided', async () => {
    Object.defineProperty(process, 'platform', { value: 'darwin' });
    const { detectRunningContext, execSync, getResolvedContext, getSourceHash, runPreflight } = await setup();

    detectRunningContext.mockReturnValue('colima');
    getResolvedContext.mockReturnValue('colima');
    mockExecCommands(execSync, {
      'docker --context colima info': () => 'ok',
      'docker --context colima run': () => 'ok',
      'docker --context colima images --format': () => '',
      'docker --context colima ps -aq': () => '',
      [`docker --context colima images -q poe-code-e2e:${getSourceHash('/repo')}`]:
        () => 'cached-image-id\n',
    });

    const result = await runPreflight({
      prebuildWorkspaceDir: '/repo',
    });

    expect(result.passed).toBe(true);
    expect(result.results).toContainEqual(
      expect.objectContaining({
        name: 'E2E image',
        passed: true,
        message: `Prepared poe-code-e2e:${getSourceHash('/repo')}`,
      }),
    );
  });

  it('fails when image prebuild fails', async () => {
    Object.defineProperty(process, 'platform', { value: 'darwin' });
    const { execSync, getSourceHash, runPreflight } = await setup();

    mockExecCommands(execSync, {
      'docker info': () => 'ok',
      [`docker images -q poe-code-e2e:${getSourceHash('/repo')}`]: () => '',
      'bun pm pack --filename': () => {
        throw new Error('build failed');
      },
    });

    const result = await runPreflight({
      prebuildWorkspaceDir: '/repo',
    });

    expect(result.passed).toBe(false);
    expect(result.results).toContainEqual(
      expect.objectContaining({
        name: 'E2E image',
        passed: false,
        message: 'build failed',
      }),
    );
  });
});

afterAll(() => {
  mock.restore();
  vi.resetModules();
});
