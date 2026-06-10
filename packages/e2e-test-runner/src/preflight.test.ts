import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('node:child_process', () => ({
  execSync: vi.fn(),
}));

vi.mock('node:fs/promises', () => ({
  access: vi.fn(),
  mkdtemp: vi.fn(),
  rm: vi.fn(),
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

vi.mock('./runtime.js', () => ({
  getWorkspaceDir: vi.fn(),
}));

function createMissingPathError(): NodeJS.ErrnoException {
  const error = new Error('missing') as NodeJS.ErrnoException;
  error.code = 'ENOENT';
  return error;
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

describe('runPreflight', () => {
  const originalPlatform = process.platform;
  const originalPath = process.env.PATH;

  beforeEach(() => {
    vi.resetAllMocks();
    vi.resetModules();
    process.env.PATH = '/usr/bin:/bin';
  });

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform });

    if (originalPath === undefined) {
      delete process.env.PATH;
    } else {
      process.env.PATH = originalPath;
    }
  });

  async function setup() {
    const { execSync } = await import('node:child_process');
    const { access, mkdtemp, rm } = await import('node:fs/promises');
    const { resolveBackend } = await import('./backend.js');
    const { detectEngine } = await import('./engine.js');
    const { hasApiKey } = await import('./credentials.js');
    const { getWorkspaceDir } = await import('./runtime.js');
    const { formatPreflightResults, runPreflight } = await import('./preflight.js');

    vi.mocked(resolveBackend).mockReturnValue('sandbox');
    vi.mocked(detectEngine).mockReturnValue('podman');
    vi.mocked(hasApiKey).mockResolvedValue(true);
    vi.mocked(getWorkspaceDir).mockReturnValue('/workspace');
    vi.mocked(execSync).mockImplementation(() => '');
    vi.mocked(mkdtemp).mockResolvedValue('/tmp/poe-e2e-test');
    vi.mocked(access).mockRejectedValue(createMissingPathError());
    vi.mocked(rm).mockResolvedValue(undefined);

    return {
      access: vi.mocked(access),
      detectEngine: vi.mocked(detectEngine),
      execSync: vi.mocked(execSync),
      getWorkspaceDir: vi.mocked(getWorkspaceDir),
      hasApiKey: vi.mocked(hasApiKey),
      mkdtemp: vi.mocked(mkdtemp),
      resolveBackend: vi.mocked(resolveBackend),
      rm: vi.mocked(rm),
      formatPreflightResults,
      runPreflight,
    };
  }

  it('formats preflight output through the shared design-system colors', async () => {
    const originalNoColor = process.env.NO_COLOR;
    const originalForceColor = process.env.FORCE_COLOR;
    delete process.env.FORCE_COLOR;
    process.env.NO_COLOR = '1';

    try {
      const { formatPreflightResults } = await setup();

      const output = formatPreflightResults(
        [
          { name: 'API key available', passed: true, message: 'ok' },
          { name: 'Podman installed', passed: false, message: 'missing', fix: 'Install Podman.' },
        ],
        { backend: 'podman', workspace: '/workspace', home: '/tmp/home' },
      );

      expect(output).toContain('Environment:');
      expect(output).toContain('  backend:   podman');
      expect(output).toContain('Preflight checks:');
      expect(output).toContain('✓ API key available: ok');
      expect(output).toContain('✗ Podman installed: missing');
      expect(output).toContain('Install Podman.');
    } finally {
      if (originalNoColor === undefined) {
        delete process.env.NO_COLOR;
      } else {
        process.env.NO_COLOR = originalNoColor;
      }

      if (originalForceColor === undefined) {
        delete process.env.FORCE_COLOR;
      } else {
        process.env.FORCE_COLOR = originalForceColor;
      }
    }
  });

  it('runs env-only checks for the env backend', async () => {
    const { access, detectEngine, execSync, mkdtemp, resolveBackend, rm, runPreflight } = await setup();
    resolveBackend.mockReturnValue('env');

    const result = await runPreflight();

    expect(result.passed).toBe(true);
    expect(result.results).toHaveLength(3);
    expect(result.results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'API key available', passed: true }),
        expect.objectContaining({ name: 'Agent not configured', passed: true }),
        expect.objectContaining({ name: 'node/npm/uv on PATH', passed: true }),
      ]),
    );
    expect(mkdtemp).toHaveBeenCalledOnce();
    expect(access).toHaveBeenCalledWith('/tmp/poe-e2e-test/.config');
    expect(rm).toHaveBeenCalledWith('/tmp/poe-e2e-test', { force: true, recursive: true });
    expect(execSync.mock.calls.map(([command]) => command)).toEqual([
      'node --version',
      'npm --version',
      'uv --version',
    ]);
    expect(execSync).not.toHaveBeenCalledWith('sandbox-exec -V', expect.anything());
    expect(execSync).not.toHaveBeenCalledWith('bwrap --version', expect.anything());
    expect(execSync).not.toHaveBeenCalledWith('podman info', expect.anything());
    expect(detectEngine).not.toHaveBeenCalled();

    const nodeVersionCall = execSync.mock.calls[0];
    expect(nodeVersionCall?.[1]).toMatchObject({
      cwd: '/workspace',
      env: expect.objectContaining({
        HOME: '/tmp/poe-e2e-test',
        NPM_CONFIG_PREFIX: '/tmp/poe-e2e-test/.npm-global',
        PATH: '/tmp/poe-e2e-test/.local/bin:/tmp/poe-e2e-test/.npm-global/bin:/workspace/node_modules/.bin:/usr/bin:/bin',
        XDG_CONFIG_HOME: '/tmp/poe-e2e-test/.config',
      }),
      stdio: 'ignore',
    });
  });

  it('checks sandbox-exec for the macOS sandbox backend', async () => {
    Object.defineProperty(process, 'platform', { value: 'darwin' });
    const { execSync, resolveBackend, runPreflight } = await setup();
    resolveBackend.mockReturnValue('sandbox');

    const result = await runPreflight();

    expect(result.passed).toBe(true);
    expect(result.results).toHaveLength(4);
    expect(result.results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'API key available', passed: true }),
        expect.objectContaining({ name: 'Agent not configured', passed: true }),
        expect.objectContaining({ name: 'node/npm/uv on PATH', passed: true }),
        expect.objectContaining({ name: 'Sandbox runtime available', passed: true }),
      ]),
    );
    expect(execSync.mock.calls.map(([command]) => command)).toEqual([
      'sandbox-exec -V',
      'node --version',
      'npm --version',
      'uv --version',
    ]);
  });

  it('checks bubblewrap for the Linux sandbox backend', async () => {
    Object.defineProperty(process, 'platform', { value: 'linux' });
    const { execSync, resolveBackend, runPreflight } = await setup();
    resolveBackend.mockReturnValue('sandbox');

    const result = await runPreflight();

    expect(result.passed).toBe(true);
    expect(execSync.mock.calls.map(([command]) => command)).toEqual([
      'bwrap --version',
      'node --version',
      'npm --version',
      'uv --version',
    ]);
    expect(result.results).toContainEqual(
      expect.objectContaining({ name: 'Sandbox runtime available', passed: true }),
    );
  });

  it('fails sandbox backend when the sandbox runtime is missing', async () => {
    Object.defineProperty(process, 'platform', { value: 'linux' });
    const { execSync, mkdtemp, resolveBackend, rm, runPreflight } = await setup();
    resolveBackend.mockReturnValue('sandbox');
    execSync.mockImplementation((command: string) => {
      if (command === 'bwrap --version') {
        throw new Error('missing');
      }
      return '';
    });

    const result = await runPreflight();

    expect(result.passed).toBe(false);
    expect(result.results).toEqual([
      expect.objectContaining({
        name: 'Sandbox runtime available',
        passed: false,
      }),
    ]);
    expect(mkdtemp).not.toHaveBeenCalled();
    expect(rm).not.toHaveBeenCalled();
  });

  it('runs only podman checks for the podman backend', async () => {
    const { access, detectEngine, execSync, mkdtemp, resolveBackend, rm, runPreflight } = await setup();
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
    expect(result.results).toHaveLength(4);
    expect(result.results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'Podman installed', passed: true }),
        expect.objectContaining({ name: 'Podman daemon running', passed: true }),
        expect.objectContaining({ name: 'API key available', passed: true }),
        expect.objectContaining({
          name: 'Cleanup',
          passed: true,
          message: 'Cleaned up 2 orphaned container(s)',
        }),
      ]),
    );
    expect(execSync.mock.calls.map(([command]) => command)).toEqual([
      'podman info',
      'podman ps -aq --filter label=poe-e2e-test-runner=true',
      'podman stop one',
      'podman rm -f one',
      'podman stop two',
      'podman rm -f two',
    ]);
    expect(mkdtemp).not.toHaveBeenCalled();
    expect(access).not.toHaveBeenCalled();
    expect(rm).not.toHaveBeenCalled();
  });

  it('fails when orphan container removal fails', async () => {
    const { detectEngine, execSync, resolveBackend, runPreflight } = await setup();
    resolveBackend.mockReturnValue('podman');
    detectEngine.mockReturnValue('podman');
    execSync.mockImplementation((command: string) => {
      if (command === 'podman info') {
        return 'ok';
      }
      if (command === 'podman ps -aq --filter label=poe-e2e-test-runner=true') {
        return 'orphan\n';
      }
      if (command === 'podman rm -f orphan') {
        throw new Error('remove failed');
      }
      return '';
    });

    const result = await runPreflight();

    expect(result.passed).toBe(false);
    expect(result.results).toContainEqual(
      expect.objectContaining({ name: 'Cleanup', passed: false }),
    );
  });

  it('fails when the isolated home already has agent config', async () => {
    const { access, execSync, resolveBackend, runPreflight } = await setup();
    resolveBackend.mockReturnValue('env');
    access.mockResolvedValue(undefined);

    const result = await runPreflight();

    expect(result.passed).toBe(false);
    expect(result.results).toEqual([
      expect.objectContaining({ name: 'API key available', passed: true }),
      expect.objectContaining({ name: 'Agent not configured', passed: false }),
    ]);
    expect(execSync).not.toHaveBeenCalled();
  });

  it('fails the agent config check when missing-path code is inherited', async () => {
    const { access, execSync, resolveBackend, runPreflight } = await setup();
    const accessError = new Error('access failed');
    resolveBackend.mockReturnValue('env');
    access.mockRejectedValue(accessError);

    await withObjectPrototypeCode('ENOENT', async () => {
      const result = await runPreflight();

      expect(result.passed).toBe(false);
      expect(result.results).toEqual([
        expect.objectContaining({ name: 'API key available', passed: true }),
        expect.objectContaining({
          name: 'Agent not configured',
          passed: false,
          message: 'access failed',
        }),
      ]);
    });
    expect(execSync).not.toHaveBeenCalled();
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

  it('fails fast when the podman daemon is not running', async () => {
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
    expect(result.results).toEqual([
      expect.objectContaining({ name: 'Podman installed', passed: true }),
      expect.objectContaining({ name: 'Podman daemon running', passed: false }),
    ]);
  });

  it('fails fast when the API key is missing', async () => {
    const { hasApiKey, mkdtemp, resolveBackend, runPreflight } = await setup();
    resolveBackend.mockReturnValue('env');
    hasApiKey.mockResolvedValue(false);

    const result = await runPreflight();

    expect(result.passed).toBe(false);
    expect(result.results).toEqual([
      expect.objectContaining({ name: 'API key available', passed: false }),
    ]);
    expect(mkdtemp).not.toHaveBeenCalled();
  });
});
