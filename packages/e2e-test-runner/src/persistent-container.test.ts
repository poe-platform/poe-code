import { describe, it, expect, vi, beforeEach } from 'vitest';
import { vol } from 'memfs';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { buildCreateArgs, buildExecArgs, CONTAINER_PATH, CONTAINER_HOME } from './persistent-container.js';
import { MOUNT_TARGET, setWorkspaceDir } from './container.js';
import { setResolvedContext } from './context.js';

function createMockChildProcess(exitCode: number, stdoutData: string, stderrData: string) {
  const child = new EventEmitter() as EventEmitter & { stdout: PassThrough; stderr: PassThrough };
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();

  process.nextTick(() => {
    if (stdoutData) child.stdout.write(Buffer.from(stdoutData));
    if (stderrData) child.stderr.write(Buffer.from(stderrData));
    child.stdout.end();
    child.stderr.end();
    child.emit('close', exitCode);
  });

  return child;
}

vi.mock('node:fs', async () => {
  const memfs = await import('memfs');
  return memfs.fs;
});

vi.mock('node:child_process', () => ({
  execSync: vi.fn(),
  spawnSync: vi.fn(),
  spawn: vi.fn(),
}));

vi.mock('./engine.js', () => ({
  detectEngine: vi.fn(() => 'docker'),
}));

vi.mock('./image.js', () => ({
  ensureImage: vi.fn(() => 'poe-code-e2e:abc123'),
  IMAGE_NAME: 'poe-code-e2e',
}));

vi.mock('./credentials.js', () => ({
  getApiKey: vi.fn(async () => 'test-api-key'),
}));

vi.mock('node:crypto', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:crypto')>();
  return {
    ...original,
    randomUUID: vi.fn(() => 'a1b2c3d4-e5f6-7890-abcd-ef1234567890'),
  };
});

describe('buildCreateArgs', () => {
  const baseConfig = {
    name: 'poe-e2e-a1b2c3d4',
    npmCacheDir: '/cache/npm',
    uvCacheDir: '/cache/uv',
    apiKey: null as string | null,
    proxyBaseUrl: null as string | null,
    image: 'poe-code-e2e:abc123',
  };

  it('starts with docker create', () => {
    const args = buildCreateArgs(baseConfig);
    expect(args[0]).toBe('create');
  });

  it('sets container name', () => {
    const args = buildCreateArgs(baseConfig);
    const nameIndex = args.indexOf('--name');
    expect(nameIndex).toBeGreaterThan(-1);
    expect(args[nameIndex + 1]).toBe('poe-e2e-a1b2c3d4');
  });

  it('adds poe-e2e-test-runner label', () => {
    const args = buildCreateArgs(baseConfig);
    const labelIndex = args.indexOf('--label');
    expect(labelIndex).toBeGreaterThan(-1);
    expect(args[labelIndex + 1]).toBe('poe-e2e-test-runner=true');
  });

  it('does not mount host workspace', () => {
    const args = buildCreateArgs(baseConfig);
    const volumeArgs = args.filter((_, i) => i > 0 && args[i - 1] === '-v');
    for (const v of volumeArgs) {
      expect(v).not.toContain(MOUNT_TARGET);
    }
  });

  it('mounts cache directories to non-root user home', () => {
    const args = buildCreateArgs(baseConfig);
    expect(args).toContain(`/cache/npm:${CONTAINER_HOME}/.npm:rw`);
    expect(args).toContain(`/cache/uv:${CONTAINER_HOME}/.cache/uv:rw`);
  });

  it('sets working directory', () => {
    const args = buildCreateArgs(baseConfig);
    const wIndex = args.indexOf('-w');
    expect(wIndex).toBeGreaterThan(-1);
    expect(args[wIndex + 1]).toBe(MOUNT_TARGET);
  });

  it('includes image and sleep command', () => {
    const args = buildCreateArgs(baseConfig);
    expect(args).toContain('poe-code-e2e:abc123');
    expect(args).toContain('sleep');
    expect(args).toContain('86400');
  });

  it('adds env vars when apiKey is provided', () => {
    const args = buildCreateArgs({ ...baseConfig, apiKey: 'test-key' });
    expect(args).toContain('-e');
    expect(args).toContain('POE_API_KEY');
    expect(args).toContain('POE_CODE_STDERR_LOGS=1');
  });

  it('does not add env vars when apiKey is null', () => {
    const args = buildCreateArgs(baseConfig);
    expect(args).not.toContain('POE_API_KEY');
  });

  it('adds POE_BASE_URL when proxy is enabled', () => {
    const args = buildCreateArgs({
      ...baseConfig,
      proxyBaseUrl: 'http://localhost:3456',
    });
    expect(args).toContain('-e');
    expect(args).toContain('POE_BASE_URL=http://localhost:3456');
  });

  it('always sets PATH env for local bins and uv', () => {
    const args = buildCreateArgs(baseConfig);
    expect(args).toContain(`PATH=${CONTAINER_PATH}`);
  });
});

describe('buildExecArgs', () => {
  it('constructs docker exec with sh -c', () => {
    const args = buildExecArgs('abc123', 'echo hello');
    expect(args).toEqual(['exec', 'abc123', 'sh', '-c', 'echo hello']);
  });

  it('passes command as single sh -c argument', () => {
    const args = buildExecArgs('cid', 'ls -la /root && cat /etc/hosts');
    expect(args[3]).toBe('-c');
    expect(args[4]).toBe('ls -la /root && cat /etc/hosts');
  });
});

describe('createContainer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vol.reset();
    // Ensure cache dirs exist in memfs
    vol.mkdirSync('/tmp', { recursive: true });
  });

  it('calls docker create with correct args and docker start', async () => {
    const { spawnSync } = await import('node:child_process');
    const mockSpawnSync = vi.mocked(spawnSync);

    mockSpawnSync.mockImplementation((_cmd, args) => {
      const argsArr = args as string[];
      if (argsArr[0] === 'create') {
        return {
          status: 0,
          stdout: 'abc123containerid\n',
          stderr: '',
          pid: 1,
          output: [],
          signal: null,
        };
      }
      if (argsArr[0] === 'start') {
        return {
          status: 0,
          stdout: '',
          stderr: '',
          pid: 1,
          output: [],
          signal: null,
        };
      }
      return {
        status: 0,
        stdout: '',
        stderr: '',
        pid: 1,
        output: [],
        signal: null,
      };
    });

    const { createContainer } = await import('./persistent-container.js');
    const container = await createContainer({ image: 'poe-code-e2e:abc123' });

    expect(container.id).toBe('abc123containerid');

    // Verify docker create was called
    const createCall = mockSpawnSync.mock.calls.find(
      (call) => (call[1] as string[])[0] === 'create'
    );
    expect(createCall).toBeDefined();
    expect(createCall![0]).toBe('docker');
    const createArgs = createCall![1] as string[];
    expect(createArgs).toContain('--name');
    expect(createArgs).toContain('--label');
    expect(createArgs).toContain('poe-e2e-test-runner=true');
    expect(createArgs).not.toContain('POE_BASE_URL=http://localhost:3456');

    // Container name matches poe-e2e-<uuid-short> pattern
    const nameIndex = createArgs.indexOf('--name');
    expect(createArgs[nameIndex + 1]).toBe('poe-e2e-a1b2c3d4');

    // Verify docker start was called with the container ID
    const startCall = mockSpawnSync.mock.calls.find(
      (call) => (call[1] as string[])[0] === 'start'
    );
    expect(startCall).toBeDefined();
    expect(startCall![0]).toBe('docker');
    expect((startCall![1] as string[])[1]).toBe('abc123containerid');

    const proxyStartCall = mockSpawnSync.mock.calls.find((call) => {
      const argsArr = call[1] as string[];
      const command = argsArr[argsArr.length - 1];
      return (
        argsArr.includes('exec') &&
        typeof command === 'string' &&
        command.includes('proxy-server --port 3456')
      );
    });
    expect(proxyStartCall).toBeUndefined();
  });

  it('throws requests() guidance when fixtures directory does not exist', async () => {
    const { spawnSync } = await import('node:child_process');
    const mockSpawnSync = vi.mocked(spawnSync);

    mockSpawnSync.mockImplementation((_cmd, args) => {
      const argsArr = args as string[];
      if (argsArr[0] === 'create') {
        return {
          status: 0,
          stdout: 'plain-container\n',
          stderr: '',
          pid: 1,
          output: [],
          signal: null,
        };
      }
      return {
        status: 0,
        stdout: '',
        stderr: '',
        pid: 1,
        output: [],
        signal: null,
      };
    });

    const { createContainer } = await import('./persistent-container.js');
    const container = await createContainer({ image: 'poe-code-e2e:abc123' });

    await expect(container.requests()).rejects.toThrow(
      'requests() requires .snapshots/<testName> directory to exist'
    );
  });

  it('throws writeSnapshots() guidance when fixtures directory does not exist', async () => {
    const { spawnSync } = await import('node:child_process');
    const mockSpawnSync = vi.mocked(spawnSync);

    mockSpawnSync.mockImplementation((_cmd, args) => {
      const argsArr = args as string[];
      if (argsArr[0] === 'create') {
        return {
          status: 0,
          stdout: 'plain-container\n',
          stderr: '',
          pid: 1,
          output: [],
          signal: null,
        };
      }
      return {
        status: 0,
        stdout: '',
        stderr: '',
        pid: 1,
        output: [],
        signal: null,
      };
    });

    const { createContainer } = await import('./persistent-container.js');
    const container = await createContainer({ image: 'poe-code-e2e:abc123' });

    await expect(container.writeSnapshots([{ key: 'x', response: { ok: true } }])).rejects.toThrow(
      'writeSnapshots() requires .snapshots/<testName> directory to exist'
    );
  });

  it('throws when useSnapshots is true without testName', async () => {
    const { createContainer } = await import('./persistent-container.js');
    await expect(
      createContainer({
        image: 'poe-code-e2e:abc123',
        useSnapshots: true,
      })
    ).rejects.toThrow('useSnapshots requires testName');
  });

  it('starts proxy lifecycle when fixtures directory exists', async () => {
    setWorkspaceDir('/workspace/repo');
    vol.mkdirSync('/workspace/repo/.snapshots/proxy', { recursive: true });
    vol.writeFileSync(
      '/workspace/repo/.snapshots/proxy/example.json',
      JSON.stringify({ key: 'example', response: { id: 'res' } }, null, 2)
    );

    const { spawnSync } = await import('node:child_process');
    const mockSpawnSync = vi.mocked(spawnSync);
    let healthChecks = 0;

    mockSpawnSync.mockImplementation((_cmd, args, options) => {
      const argsArr = args as string[];
      const command = argsArr[argsArr.length - 1] ?? '';

      if (argsArr.includes('create')) {
        return {
          status: 0,
          stdout: 'proxy-container\n',
          stderr: '',
          pid: 1,
          output: [],
          signal: null,
        };
      }

      if (
        argsArr.includes('exec') &&
        typeof command === 'string' &&
        command.includes('fetch("http://127.0.0.1:3456/__health__")')
      ) {
        healthChecks += 1;
        if (healthChecks === 1) {
          return {
            status: 1,
            stdout: '',
            stderr: 'connect failed',
            pid: 1,
            output: [],
            signal: null,
          };
        }
        return {
          status: 0,
          stdout: '',
          stderr: '',
          pid: 1,
          output: [],
          signal: null,
        };
      }

      if (
        argsArr.includes('cp') &&
        options &&
        typeof options === 'object' &&
        'encoding' in options
      ) {
        return {
          status: 0,
          stdout: '',
          stderr: '',
          pid: 1,
          output: [],
          signal: null,
        };
      }

      if (
        argsArr.includes('exec') &&
        typeof command === 'string' &&
        command === 'cat /tmp/proxy-capture.jsonl'
      ) {
        return {
          status: 0,
          stdout: [
            JSON.stringify({
              timestamp: '2026-01-01T00:00:00.000Z',
              route: '/v1/chat/completions',
              request: { method: 'POST', path: '/v1/chat/completions', headers: {}, body: { model: 'x' } },
              response: { status: 200, body: { id: 'r1' } },
            }),
            JSON.stringify({
              timestamp: '2026-01-01T00:00:01.000Z',
              route: '/v1/chat/completions',
              request: { method: 'POST', path: '/v1/chat/completions', headers: {}, body: { model: 'y' } },
              response: { status: 200, body: { id: 'r2' } },
            }),
          ].join('\n'),
          stderr: '',
          pid: 1,
          output: [],
          signal: null,
        };
      }

      return {
        status: 0,
        stdout: '',
        stderr: '',
        pid: 1,
        output: [],
        signal: null,
      };
    });

    const { createContainer } = await import('./persistent-container.js');
    const container = await createContainer({
      image: 'poe-code-e2e:abc123',
      testName: 'proxy',
      useSnapshots: true,
    });

    expect(container.id).toBe('proxy-container');
    expect(healthChecks).toBe(2);

    const createCall = mockSpawnSync.mock.calls.find(
      (call) => (call[1] as string[]).includes('create')
    );
    expect(createCall).toBeDefined();
    expect(createCall![1]).toContain('POE_BASE_URL=http://localhost:3456');

    const cpCall = mockSpawnSync.mock.calls.find(
      (call) => {
        const argsArr = call[1] as string[];
        return (
          argsArr.includes('cp') &&
          argsArr.includes('/workspace/repo/.snapshots/proxy/.') &&
          argsArr.includes('proxy-container:/tmp/proxy-snapshots/')
        );
      }
    );
    expect(cpCall).toBeDefined();

    const startProxyCall = mockSpawnSync.mock.calls.find(
      (call) => {
        const argsArr = call[1] as string[];
        const command = argsArr[argsArr.length - 1];
        return (
          argsArr.includes('exec') &&
          typeof command === 'string' &&
          command.includes('nohup') &&
          command.includes('proxy-server --port 3456') &&
          command.includes('/v1/chat/completions=playback:/tmp/proxy-snapshots/')
        );
      }
    );
    expect(startProxyCall).toBeDefined();

    const requests = await container.requests();
    expect(requests.length).toBe(2);

    await container.writeSnapshots([{ key: 'new-key', response: { id: 'new' } }]);
    const writeSnapshotCall = mockSpawnSync.mock.calls.find(
      (call) => {
        const argsArr = call[1] as string[];
        return (
          argsArr.includes('exec') &&
          argsArr.includes('-i') &&
          argsArr.includes('proxy-container') &&
          argsArr.includes('cat > /tmp/proxy-snapshots/new-key.json')
        );
      }
    );
    expect(writeSnapshotCall).toBeDefined();
  });

  it('does not start proxy when useSnapshots is false even if fixtures directory exists', async () => {
    setWorkspaceDir('/workspace/repo');
    vol.mkdirSync('/workspace/repo/.snapshots/proxy', { recursive: true });

    const { spawnSync } = await import('node:child_process');
    const mockSpawnSync = vi.mocked(spawnSync);

    mockSpawnSync.mockImplementation((_cmd, args) => {
      const argsArr = args as string[];
      if (argsArr.includes('create')) {
        return {
          status: 0,
          stdout: 'plain-container\n',
          stderr: '',
          pid: 1,
          output: [],
          signal: null,
        };
      }
      return {
        status: 0,
        stdout: '',
        stderr: '',
        pid: 1,
        output: [],
        signal: null,
      };
    });

    const { createContainer } = await import('./persistent-container.js');
    await createContainer({
      image: 'poe-code-e2e:abc123',
      testName: 'proxy',
      useSnapshots: false,
    });

    const createCall = mockSpawnSync.mock.calls.find(
      (call) => (call[1] as string[]).includes('create')
    );
    expect(createCall).toBeDefined();
    expect(createCall![1]).not.toContain('POE_BASE_URL=http://localhost:3456');

    const startProxyCall = mockSpawnSync.mock.calls.find((call) => {
      const argsArr = call[1] as string[];
      const command = argsArr[argsArr.length - 1];
      return (
        argsArr.includes('exec') &&
        typeof command === 'string' &&
        command.includes('proxy-server --port 3456')
      );
    });
    expect(startProxyCall).toBeUndefined();
  });

  it('waits for slow proxy startup before failing health checks', async () => {
    setWorkspaceDir('/workspace/repo');
    vol.mkdirSync('/workspace/repo/.snapshots/proxy', { recursive: true });

    const { spawnSync } = await import('node:child_process');
    const mockSpawnSync = vi.mocked(spawnSync);
    const setTimeoutSpy = vi
      .spyOn(globalThis, 'setTimeout')
      .mockImplementation((callback: Parameters<typeof setTimeout>[0]) => {
        if (typeof callback === 'function') {
          callback();
        }
        return 0 as unknown as ReturnType<typeof setTimeout>;
      });

    let healthChecks = 0;
    mockSpawnSync.mockImplementation((_cmd, args) => {
      const argsArr = args as string[];
      const command = argsArr[argsArr.length - 1] ?? '';

      if (
        argsArr.includes('exec') &&
        typeof command === 'string' &&
        command.includes('fetch("http://127.0.0.1:3456/__health__")')
      ) {
        healthChecks += 1;
        return {
          status: healthChecks < 60 ? 1 : 0,
          stdout: '',
          stderr: '',
          pid: 1,
          output: [],
          signal: null,
        };
      }

      if (argsArr.includes('create')) {
        return {
          status: 0,
          stdout: 'slow-proxy-container\n',
          stderr: '',
          pid: 1,
          output: [],
          signal: null,
        };
      }

      return {
        status: 0,
        stdout: '',
        stderr: '',
        pid: 1,
        output: [],
        signal: null,
      };
    });

    try {
      const { createContainer } = await import('./persistent-container.js');
      const container = await createContainer({
        image: 'poe-code-e2e:abc123',
        testName: 'proxy',
        useSnapshots: true,
      });
      expect(container.id).toBe('slow-proxy-container');
      expect(healthChecks).toBe(60);
    } finally {
      setTimeoutSpy.mockRestore();
    }
  });

  it('uses POE_SNAPSHOT_MODE when provided', async () => {
    const originalProxyMode = process.env.POE_SNAPSHOT_MODE;
    process.env.POE_SNAPSHOT_MODE = 'record';
    setWorkspaceDir('/workspace/repo');
    vol.mkdirSync('/workspace/repo/.snapshots/proxy', { recursive: true });

    try {
      const { spawnSync } = await import('node:child_process');
      const mockSpawnSync = vi.mocked(spawnSync);

      mockSpawnSync.mockImplementation((_cmd, args) => {
        const argsArr = args as string[];
        if (argsArr.includes('create')) {
          return {
            status: 0,
            stdout: 'proxy-container\n',
            stderr: '',
            pid: 1,
            output: [],
            signal: null,
          };
        }
        return {
          status: 0,
          stdout: '',
          stderr: '',
          pid: 1,
          output: [],
          signal: null,
        };
      });

      const { createContainer } = await import('./persistent-container.js');
      await createContainer({
        image: 'poe-code-e2e:abc123',
        testName: 'proxy',
        useSnapshots: true,
      });

      const startProxyCall = mockSpawnSync.mock.calls.find(
        (call) => {
          const argsArr = call[1] as string[];
          const command = argsArr[argsArr.length - 1];
          return (
            argsArr.includes('exec') &&
            typeof command === 'string' &&
            command.includes('nohup') &&
            command.includes('proxy-server --port 3456') &&
            command.includes('/v1/chat/completions=record:/tmp/proxy-snapshots/') &&
            command.includes('--miss error')
          );
        }
      );
      expect(startProxyCall).toBeDefined();
    } finally {
      if (originalProxyMode === undefined) {
        delete process.env.POE_SNAPSHOT_MODE;
      } else {
        process.env.POE_SNAPSHOT_MODE = originalProxyMode;
      }
    }
  });

  it('does not evaluate POE_SNAPSHOT_MODE without fixtures directory', async () => {
    const originalProxyMode = process.env.POE_SNAPSHOT_MODE;
    process.env.POE_SNAPSHOT_MODE = 'invalid-mode';

    try {
      const { spawnSync } = await import('node:child_process');
      const mockSpawnSync = vi.mocked(spawnSync);

      mockSpawnSync.mockImplementation((_cmd, args) => {
        const argsArr = args as string[];
        if (argsArr.includes('create')) {
          return {
            status: 0,
            stdout: 'plain-container\n',
            stderr: '',
            pid: 1,
            output: [],
            signal: null,
          };
        }
        return {
          status: 0,
          stdout: '',
          stderr: '',
          pid: 1,
          output: [],
          signal: null,
        };
      });

      const { createContainer } = await import('./persistent-container.js');
      await expect(createContainer({ image: 'poe-code-e2e:abc123' })).resolves.toBeDefined();
    } finally {
      if (originalProxyMode === undefined) {
        delete process.env.POE_SNAPSHOT_MODE;
      } else {
        process.env.POE_SNAPSHOT_MODE = originalProxyMode;
      }
    }
  });

  it('auto-creates snapshot directory when POE_SNAPSHOT_MISS=record', async () => {
    const originalMiss = process.env.POE_SNAPSHOT_MISS;
    process.env.POE_SNAPSHOT_MISS = 'record';
    setWorkspaceDir('/workspace/repo');
    vol.mkdirSync('/workspace/repo/.snapshots', { recursive: true });

    try {
      const { spawnSync } = await import('node:child_process');
      const mockSpawnSync = vi.mocked(spawnSync);

      mockSpawnSync.mockImplementation((_cmd, args) => {
        const argsArr = args as string[];
        if (argsArr.includes('create')) {
          return {
            status: 0,
            stdout: 'auto-dir-container\n',
            stderr: '',
            pid: 1,
            output: [],
            signal: null,
          };
        }
        return {
          status: 0,
          stdout: '',
          stderr: '',
          pid: 1,
          output: [],
          signal: null,
        };
      });

      const { existsSync } = await import('node:fs');
      expect(existsSync('/workspace/repo/.snapshots/new-test')).toBe(false);

      const { createContainer } = await import('./persistent-container.js');
      await createContainer({
        image: 'poe-code-e2e:abc123',
        testName: 'new-test',
        useSnapshots: true,
      });

      expect(existsSync('/workspace/repo/.snapshots/new-test')).toBe(true);
    } finally {
      if (originalMiss === undefined) {
        delete process.env.POE_SNAPSHOT_MISS;
      } else {
        process.env.POE_SNAPSHOT_MISS = originalMiss;
      }
    }
  });

  it('does not auto-create snapshot directory without recording env vars', async () => {
    const originalMiss = process.env.POE_SNAPSHOT_MISS;
    const originalMode = process.env.POE_SNAPSHOT_MODE;
    delete process.env.POE_SNAPSHOT_MISS;
    delete process.env.POE_SNAPSHOT_MODE;
    setWorkspaceDir('/workspace/repo');
    vol.mkdirSync('/workspace/repo/.snapshots', { recursive: true });

    try {
      const { spawnSync } = await import('node:child_process');
      const mockSpawnSync = vi.mocked(spawnSync);

      mockSpawnSync.mockImplementation((_cmd, args) => {
        const argsArr = args as string[];
        if (argsArr.includes('create')) {
          return {
            status: 0,
            stdout: 'no-auto-container\n',
            stderr: '',
            pid: 1,
            output: [],
            signal: null,
          };
        }
        return {
          status: 0,
          stdout: '',
          stderr: '',
          pid: 1,
          output: [],
          signal: null,
        };
      });

      const { existsSync } = await import('node:fs');
      expect(existsSync('/workspace/repo/.snapshots/missing-test')).toBe(false);

      const { createContainer } = await import('./persistent-container.js');
      await createContainer({
        image: 'poe-code-e2e:abc123',
        testName: 'missing-test',
        useSnapshots: true,
      });

      expect(existsSync('/workspace/repo/.snapshots/missing-test')).toBe(false);
    } finally {
      if (originalMiss === undefined) {
        delete process.env.POE_SNAPSHOT_MISS;
      } else {
        process.env.POE_SNAPSHOT_MISS = originalMiss;
      }
      if (originalMode === undefined) {
        delete process.env.POE_SNAPSHOT_MODE;
      } else {
        process.env.POE_SNAPSHOT_MODE = originalMode;
      }
    }
  });

  it('throws when docker create fails', async () => {
    const { spawnSync } = await import('node:child_process');
    vi.mocked(spawnSync).mockReturnValue({
      status: 1,
      stdout: '',
      stderr: 'create failed',
      pid: 1,
      output: [],
      signal: null,
    });

    const { createContainer } = await import('./persistent-container.js');
    await expect(createContainer({ image: 'poe-code-e2e:abc123' })).rejects.toThrow(
      'Failed to create container: create failed'
    );
  });

  it('throws and cleans up when docker start fails', async () => {
    const { spawnSync } = await import('node:child_process');
    const mockSpawnSync = vi.mocked(spawnSync);

    mockSpawnSync.mockImplementation((_cmd, args) => {
      const argsArr = args as string[];
      if (argsArr[0] === 'create') {
        return {
          status: 0,
          stdout: 'abc123containerid\n',
          stderr: '',
          pid: 1,
          output: [],
          signal: null,
        };
      }
      if (argsArr[0] === 'start') {
        return {
          status: 1,
          stdout: '',
          stderr: 'start failed',
          pid: 1,
          output: [],
          signal: null,
        };
      }
      // rm -f cleanup
      return {
        status: 0,
        stdout: '',
        stderr: '',
        pid: 1,
        output: [],
        signal: null,
      };
    });

    const { createContainer } = await import('./persistent-container.js');
    await expect(createContainer({ image: 'poe-code-e2e:abc123' })).rejects.toThrow(
      'Failed to start container: start failed'
    );

    // Verify cleanup rm -f was called
    const rmCall = mockSpawnSync.mock.calls.find(
      (call) => (call[1] as string[])[0] === 'rm'
    );
    expect(rmCall).toBeDefined();
    expect((rmCall![1] as string[])).toEqual(['rm', '-f', 'abc123containerid']);
  });
});

describe('destroy', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vol.reset();
  });

  it('calls docker rm -f with container id', async () => {
    const { spawnSync } = await import('node:child_process');
    const mockSpawnSync = vi.mocked(spawnSync);

    mockSpawnSync.mockImplementation((_cmd, args) => {
      const argsArr = args as string[];
      if (argsArr[0] === 'create') {
        return {
          status: 0,
          stdout: 'my-container-id\n',
          stderr: '',
          pid: 1,
          output: [],
          signal: null,
        };
      }
      return {
        status: 0,
        stdout: '',
        stderr: '',
        pid: 1,
        output: [],
        signal: null,
      };
    });

    const { createContainer } = await import('./persistent-container.js');
    const container = await createContainer({ image: 'poe-code-e2e:abc123' });

    mockSpawnSync.mockClear();

    await container.destroy();

    expect(mockSpawnSync).toHaveBeenCalledWith(
      'docker',
      ['rm', '-f', 'my-container-id'],
      { stdio: 'ignore' }
    );
  });
});

function setupContainerMock() {
  return async () => {
    const { spawnSync } = await import('node:child_process');
    const mockSpawnSync = vi.mocked(spawnSync);

    mockSpawnSync.mockImplementation((_cmd, args) => {
      const argsArr = args as string[];
      if (argsArr[0] === 'create') {
        return {
          status: 0,
          stdout: 'test-container-id\n',
          stderr: '',
          pid: 1,
          output: [],
          signal: null,
        };
      }
      return {
        status: 0,
        stdout: '',
        stderr: '',
        pid: 1,
        output: [],
        signal: null,
      };
    });

    const { createContainer } = await import('./persistent-container.js');
    const container = await createContainer({ image: 'poe-code-e2e:abc123' });
    mockSpawnSync.mockClear();

    return { container, mockSpawnSync };
  };
}

describe('exec', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vol.reset();
  });

  it('calls docker exec with sh -c and the command', async () => {
    const { container, mockSpawnSync } = await setupContainerMock()();

    mockSpawnSync.mockReturnValue({
      status: 0,
      stdout: 'hello\n',
      stderr: '',
      pid: 1,
      output: [],
      signal: null,
    });

    await container.exec('echo hello');

    expect(mockSpawnSync).toHaveBeenCalledWith(
      'docker',
      ['exec', 'test-container-id', 'sh', '-c', 'echo hello'],
      { encoding: 'utf-8', stdio: 'pipe' }
    );
  });

  it('returns trimmed stdout and stderr', async () => {
    const { container, mockSpawnSync } = await setupContainerMock()();

    mockSpawnSync.mockReturnValue({
      status: 0,
      stdout: '  output with spaces  \n',
      stderr: '  some warning  \n',
      pid: 1,
      output: [],
      signal: null,
    });

    const result = await container.exec('some-command');

    expect(result).toEqual({
      exitCode: 0,
      stdout: 'output with spaces',
      stderr: 'some warning',
      command: 'some-command',
    });
  });

  it('returns non-zero exit code without throwing', async () => {
    const { container, mockSpawnSync } = await setupContainerMock()();

    mockSpawnSync.mockReturnValue({
      status: 42,
      stdout: '',
      stderr: 'command not found\n',
      pid: 1,
      output: [],
      signal: null,
    });

    const result = await container.exec('bad-command');

    expect(result.exitCode).toBe(42);
    expect(result.stderr).toBe('command not found');
  });

  it('defaults exitCode to 1 when status is null', async () => {
    const { container, mockSpawnSync } = await setupContainerMock()();

    mockSpawnSync.mockReturnValue({
      status: null,
      stdout: '',
      stderr: '',
      pid: 1,
      output: [],
      signal: 'SIGTERM',
    });

    const result = await container.exec('killed-command');

    expect(result.exitCode).toBe(1);
  });

  it('handles null stdout/stderr gracefully', async () => {
    const { container, mockSpawnSync } = await setupContainerMock()();

    mockSpawnSync.mockReturnValue({
      status: 0,
      stdout: null as unknown as string,
      stderr: null as unknown as string,
      pid: 1,
      output: [],
      signal: null,
    });

    const result = await container.exec('some-command');

    expect(result.stdout).toBe('');
    expect(result.stderr).toBe('');
  });

  it('uses async spawn and streams to stderr when E2E_VERBOSE=1', async () => {
    const originalVerbose = process.env.E2E_VERBOSE;
    process.env.E2E_VERBOSE = '1';

    try {
      const { container, mockSpawnSync } = await setupContainerMock()();
      const { spawn } = await import('node:child_process');
      const mockSpawn = vi.mocked(spawn);

      const mockChild = createMockChildProcess(0, 'streamed output\n', 'streamed warning\n');
      mockSpawn.mockReturnValue(mockChild as never);

      const stderrWrites: string[] = [];
      const origWrite = process.stderr.write;
      process.stderr.write = ((chunk: Buffer | string) => {
        stderrWrites.push(chunk.toString());
        return true;
      }) as typeof process.stderr.write;

      const result = await container.exec('echo hello');

      process.stderr.write = origWrite;

      // Should NOT call spawnSync for the exec
      expect(mockSpawnSync).not.toHaveBeenCalled();

      // Should call async spawn
      expect(mockSpawn).toHaveBeenCalledWith(
        'docker',
        ['exec', 'test-container-id', 'sh', '-c', 'echo hello'],
        { stdio: ['ignore', 'pipe', 'pipe'] }
      );

      // Output should be captured in result
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe('streamed output');
      expect(result.stderr).toBe('streamed warning');

      // Output should have been streamed to stderr
      const allStderr = stderrWrites.join('');
      expect(allStderr).toContain('streamed output');
      expect(allStderr).toContain('streamed warning');
    } finally {
      if (originalVerbose === undefined) {
        delete process.env.E2E_VERBOSE;
      } else {
        process.env.E2E_VERBOSE = originalVerbose;
      }
    }
  });

  it('does not use async spawn when E2E_VERBOSE is not set', async () => {
    const originalVerbose = process.env.E2E_VERBOSE;
    delete process.env.E2E_VERBOSE;

    try {
      const { container, mockSpawnSync } = await setupContainerMock()();
      const { spawn } = await import('node:child_process');
      const mockSpawn = vi.mocked(spawn);

      mockSpawnSync.mockReturnValue({
        status: 0,
        stdout: 'hello\n',
        stderr: '',
        pid: 1,
        output: [],
        signal: null,
      });

      await container.exec('echo hello');

      expect(mockSpawnSync).toHaveBeenCalled();
      expect(mockSpawn).not.toHaveBeenCalled();
    } finally {
      if (originalVerbose === undefined) {
        delete process.env.E2E_VERBOSE;
      } else {
        process.env.E2E_VERBOSE = originalVerbose;
      }
    }
  });
});

describe('readFile', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vol.reset();
  });

  it('calls exec with cat <path> and returns stdout', async () => {
    const { container, mockSpawnSync } = await setupContainerMock()();

    mockSpawnSync.mockReturnValue({
      status: 0,
      stdout: '{"key": "value"}\n',
      stderr: '',
      pid: 1,
      output: [],
      signal: null,
    });

    const content = await container.readFile('/root/.config/settings.json');

    expect(mockSpawnSync).toHaveBeenCalledWith(
      'docker',
      ['exec', 'test-container-id', 'sh', '-c', 'cat /root/.config/settings.json'],
      { encoding: 'utf-8', stdio: 'pipe' }
    );
    expect(content).toBe('{"key": "value"}');
  });

  it('does not stream output even when E2E_VERBOSE=1', async () => {
    const originalVerbose = process.env.E2E_VERBOSE;
    process.env.E2E_VERBOSE = '1';

    try {
      const { container, mockSpawnSync } = await setupContainerMock()();
      const { spawn } = await import('node:child_process');
      const mockSpawn = vi.mocked(spawn);

      mockSpawnSync.mockReturnValue({
        status: 0,
        stdout: '{"key": "secret"}\n',
        stderr: '',
        pid: 1,
        output: [],
        signal: null,
      });

      await container.readFile('/home/poe/.local/share/opencode/auth.json');

      // Should use spawnSync (quiet), not async spawn (streaming)
      expect(mockSpawnSync).toHaveBeenCalled();
      expect(mockSpawn).not.toHaveBeenCalled();
    } finally {
      if (originalVerbose === undefined) {
        delete process.env.E2E_VERBOSE;
      } else {
        process.env.E2E_VERBOSE = originalVerbose;
      }
    }
  });

  it('throws with clear message if file does not exist', async () => {
    const { container, mockSpawnSync } = await setupContainerMock()();

    mockSpawnSync.mockReturnValue({
      status: 1,
      stdout: '',
      stderr: 'cat: /no/such/file: No such file or directory\n',
      pid: 1,
      output: [],
      signal: null,
    });

    await expect(container.readFile('/no/such/file')).rejects.toThrow(
      'Failed to read file "/no/such/file"'
    );
    await expect(container.readFile('/no/such/file')).rejects.toThrow(
      'No such file or directory'
    );
  });
});

describe('fileExists', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vol.reset();
  });

  it('returns true when file exists (exit code 0)', async () => {
    const { container, mockSpawnSync } = await setupContainerMock()();

    mockSpawnSync.mockReturnValue({
      status: 0,
      stdout: '',
      stderr: '',
      pid: 1,
      output: [],
      signal: null,
    });

    const exists = await container.fileExists('/root/.config/settings.json');

    expect(mockSpawnSync).toHaveBeenCalledWith(
      'docker',
      ['exec', 'test-container-id', 'sh', '-c', 'test -f /root/.config/settings.json'],
      { encoding: 'utf-8', stdio: 'pipe' }
    );
    expect(exists).toBe(true);
  });

  it('returns false when file does not exist (non-zero exit)', async () => {
    const { container, mockSpawnSync } = await setupContainerMock()();

    mockSpawnSync.mockReturnValue({
      status: 1,
      stdout: '',
      stderr: '',
      pid: 1,
      output: [],
      signal: null,
    });

    const exists = await container.fileExists('/no/such/file');

    expect(exists).toBe(false);
  });
});

describe('writeFile', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vol.reset();
  });

  it('calls docker exec -i with content piped to stdin', async () => {
    const { container, mockSpawnSync } = await setupContainerMock()();

    mockSpawnSync.mockReturnValue({
      status: 0,
      stdout: '',
      stderr: '',
      pid: 1,
      output: [],
      signal: null,
    });

    await container.writeFile('/root/.config/settings.json', '{"key": "value"}');

    expect(mockSpawnSync).toHaveBeenCalledWith(
      'docker',
      ['exec', '-i', 'test-container-id', 'sh', '-c', 'cat > /root/.config/settings.json'],
      { encoding: 'utf-8', input: '{"key": "value"}', stdio: ['pipe', 'pipe', 'pipe'] }
    );
  });

  it('throws when write fails', async () => {
    const { container, mockSpawnSync } = await setupContainerMock()();

    mockSpawnSync.mockReturnValue({
      status: 1,
      stdout: '',
      stderr: 'Permission denied\n',
      pid: 1,
      output: [],
      signal: null,
    });

    await expect(
      container.writeFile('/readonly/file', 'content')
    ).rejects.toThrow('Failed to write file "/readonly/file": Permission denied');
  });
});

describe('execOrThrow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vol.reset();
  });

  it('returns result on exit code 0', async () => {
    const { container, mockSpawnSync } = await setupContainerMock()();

    mockSpawnSync.mockReturnValue({
      status: 0,
      stdout: 'success output\n',
      stderr: '',
      pid: 1,
      output: [],
      signal: null,
    });

    const result = await container.execOrThrow('echo ok');

    expect(result).toEqual({
      exitCode: 0,
      stdout: 'success output',
      stderr: '',
      command: 'echo ok',
    });
  });

  it('throws on non-zero exit code with command, code, and stderr', async () => {
    const { container, mockSpawnSync } = await setupContainerMock()();

    mockSpawnSync.mockReturnValue({
      status: 127,
      stdout: '',
      stderr: 'sh: bad-cmd: not found\n',
      pid: 1,
      output: [],
      signal: null,
    });

    await expect(container.execOrThrow('bad-cmd')).rejects.toThrow(
      'Command failed: "bad-cmd" (exit code 127)'
    );
    await expect(container.execOrThrow('bad-cmd')).rejects.toThrow(
      'sh: bad-cmd: not found'
    );
  });
});

describe('login', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    vol.reset();
    const { getApiKey } = await import('./credentials.js');
    vi.mocked(getApiKey).mockResolvedValue('test-api-key');
  });

  it('runs login without passing API key on command line', async () => {
    const { container, mockSpawnSync } = await setupContainerMock()();

    mockSpawnSync.mockReturnValue({
      status: 0,
      stdout: 'Logged in successfully\n',
      stderr: '',
      pid: 1,
      output: [],
      signal: null,
    });

    await container.login();

    const loginCall = mockSpawnSync.mock.calls.find(
      (call) => {
        const args = call[1] as string[];
        return args.includes('exec') && args.some(a => a.includes('poe-code --yes login'));
      }
    );
    expect(loginCall).toBeDefined();
    const loginCmd = (loginCall![1] as string[]).find(a => a.includes('poe-code --yes login'));
    expect(loginCmd).toBe('poe-code --yes login');
    expect(loginCmd).not.toContain('--api-key');
  });

  it('throws if no API key is available', async () => {
    const { getApiKey } = await import('./credentials.js');
    vi.mocked(getApiKey).mockResolvedValue(null);

    const { spawnSync } = await import('node:child_process');
    const mockSpawnSync = vi.mocked(spawnSync);

    mockSpawnSync.mockImplementation((_cmd, args) => {
      const argsArr = args as string[];
      if (argsArr[0] === 'create') {
        return {
          status: 0,
          stdout: 'no-key-container\n',
          stderr: '',
          pid: 1,
          output: [],
          signal: null,
        };
      }
      return {
        status: 0,
        stdout: '',
        stderr: '',
        pid: 1,
        output: [],
        signal: null,
      };
    });

    const { createContainer } = await import('./persistent-container.js');
    const container = await createContainer({ image: 'poe-code-e2e:abc123' });

    await expect(container.login()).rejects.toThrow(
      'No API key available'
    );
  });

  it('throws on login failure without exposing API key', async () => {
    const { container, mockSpawnSync } = await setupContainerMock()();

    mockSpawnSync.mockReturnValue({
      status: 1,
      stdout: '',
      stderr: 'Login failed: invalid key\n',
      pid: 1,
      output: [],
      signal: null,
    });

    await expect(container.login()).rejects.toThrow('Command failed: "poe-code --yes login"');
  });
});

describe('docker context support', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vol.reset();
    setResolvedContext(null);
  });

  it('prepends --context args to docker create when context is set', async () => {
    setResolvedContext('colima-poe-runner');

    const { spawnSync } = await import('node:child_process');
    const mockSpawnSync = vi.mocked(spawnSync);

    mockSpawnSync.mockImplementation((_cmd, args) => {
      const argsArr = args as string[];
      if (argsArr.includes('create')) {
        return { status: 0, stdout: 'ctx-container\n', stderr: '', pid: 1, output: [], signal: null };
      }
      return { status: 0, stdout: '', stderr: '', pid: 1, output: [], signal: null };
    });

    const { createContainer } = await import('./persistent-container.js');
    await createContainer({ image: 'poe-code-e2e:abc123' });

    const createCall = mockSpawnSync.mock.calls.find(
      (call) => (call[1] as string[]).includes('create')
    );
    expect(createCall).toBeDefined();
    const createArgs = createCall![1] as string[];
    expect(createArgs[0]).toBe('--context');
    expect(createArgs[1]).toBe('colima-poe-runner');
    expect(createArgs[2]).toBe('create');
  });

  it('prepends --context args to docker start', async () => {
    setResolvedContext('colima-poe-runner');

    const { spawnSync } = await import('node:child_process');
    const mockSpawnSync = vi.mocked(spawnSync);

    mockSpawnSync.mockImplementation((_cmd, args) => {
      const argsArr = args as string[];
      if (argsArr.includes('create')) {
        return { status: 0, stdout: 'ctx-container\n', stderr: '', pid: 1, output: [], signal: null };
      }
      return { status: 0, stdout: '', stderr: '', pid: 1, output: [], signal: null };
    });

    const { createContainer } = await import('./persistent-container.js');
    await createContainer({ image: 'poe-code-e2e:abc123' });

    const startCall = mockSpawnSync.mock.calls.find(
      (call) => (call[1] as string[]).includes('start')
    );
    expect(startCall).toBeDefined();
    const startArgs = startCall![1] as string[];
    expect(startArgs[0]).toBe('--context');
    expect(startArgs[1]).toBe('colima-poe-runner');
    expect(startArgs[2]).toBe('start');
  });

  it('prepends --context args to docker exec', async () => {
    setResolvedContext('colima-poe-runner');

    const { spawnSync } = await import('node:child_process');
    const mockSpawnSync = vi.mocked(spawnSync);

    mockSpawnSync.mockImplementation((_cmd, args) => {
      const argsArr = args as string[];
      if (argsArr.includes('create')) {
        return { status: 0, stdout: 'ctx-container\n', stderr: '', pid: 1, output: [], signal: null };
      }
      return { status: 0, stdout: 'output\n', stderr: '', pid: 1, output: [], signal: null };
    });

    const { createContainer } = await import('./persistent-container.js');
    const container = await createContainer({ image: 'poe-code-e2e:abc123' });

    mockSpawnSync.mockClear();
    mockSpawnSync.mockReturnValue({ status: 0, stdout: 'hello\n', stderr: '', pid: 1, output: [], signal: null });

    await container.exec('echo hello');

    expect(mockSpawnSync).toHaveBeenCalledWith(
      'docker',
      ['--context', 'colima-poe-runner', 'exec', 'ctx-container', 'sh', '-c', 'echo hello'],
      { encoding: 'utf-8', stdio: 'pipe' }
    );
  });

  it('prepends --context args to docker rm on destroy', async () => {
    setResolvedContext('colima-poe-runner');

    const { spawnSync } = await import('node:child_process');
    const mockSpawnSync = vi.mocked(spawnSync);

    mockSpawnSync.mockImplementation((_cmd, args) => {
      const argsArr = args as string[];
      if (argsArr.includes('create')) {
        return { status: 0, stdout: 'ctx-container\n', stderr: '', pid: 1, output: [], signal: null };
      }
      return { status: 0, stdout: '', stderr: '', pid: 1, output: [], signal: null };
    });

    const { createContainer } = await import('./persistent-container.js');
    const container = await createContainer({ image: 'poe-code-e2e:abc123' });

    mockSpawnSync.mockClear();

    await container.destroy();

    expect(mockSpawnSync).toHaveBeenCalledWith(
      'docker',
      ['--context', 'colima-poe-runner', 'rm', '-f', 'ctx-container'],
      { stdio: 'ignore' }
    );
  });

  it('does not add context args when no context is set', async () => {
    setResolvedContext(null);

    const { spawnSync } = await import('node:child_process');
    const mockSpawnSync = vi.mocked(spawnSync);

    mockSpawnSync.mockImplementation((_cmd, args) => {
      const argsArr = args as string[];
      if (argsArr[0] === 'create') {
        return { status: 0, stdout: 'no-ctx-container\n', stderr: '', pid: 1, output: [], signal: null };
      }
      return { status: 0, stdout: '', stderr: '', pid: 1, output: [], signal: null };
    });

    const { createContainer } = await import('./persistent-container.js');
    await createContainer({ image: 'poe-code-e2e:abc123' });

    const createCall = mockSpawnSync.mock.calls.find(
      (call) => (call[1] as string[]).includes('create')
    );
    expect(createCall).toBeDefined();
    const createArgs = createCall![1] as string[];
    expect(createArgs[0]).toBe('create');
  });
});
