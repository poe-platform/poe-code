import { describe, expect, it, vi } from 'vitest';
import type { ProxyConfig } from './proxy-types.js';
import { isCliInvocation, parseProxyConfigFromArgs, runProxyCli } from './proxy-cli.js';

describe('parseProxyConfigFromArgs', () => {
  it('parses inline flags with default onMiss', async () => {
    const config = await parseProxyConfigFromArgs([
      '--port',
      '3456',
      '--capture',
      '/tmp/proxy-capture.jsonl',
      '--route',
      '/v1/chat/completions=playback:/tmp/proxy-snapshots',
    ]);

    expect(config).toEqual<ProxyConfig>({
      port: 3456,
      captureFile: '/tmp/proxy-capture.jsonl',
      onMiss: 'error',
      routes: [
        {
          path: '/v1/chat/completions',
          mode: 'playback',
          snapshotDir: '/tmp/proxy-snapshots',
          target: 'https://api.poe.com',
        },
      ],
    });
  });

  it('parses --miss flag', async () => {
    const config = await parseProxyConfigFromArgs([
      '--port',
      '3456',
      '--capture',
      '/tmp/proxy-capture.jsonl',
      '--route',
      '/v1/chat/completions=playback:/tmp/proxy-snapshots',
      '--miss',
      'record',
    ]);

    expect(config.onMiss).toBe('record');
  });

  it('throws on invalid --miss value', async () => {
    await expect(
      parseProxyConfigFromArgs([
        '--port',
        '3456',
        '--capture',
        '/tmp/proxy-capture.jsonl',
        '--route',
        '/v1/chat/completions=playback:/tmp/proxy-snapshots',
        '--miss',
        'invalid',
      ]),
    ).rejects.toThrow('Invalid --miss value: invalid');
  });

  it('loads JSON config with --config path', async () => {
    const configFromFile: ProxyConfig = {
      port: 4000,
      captureFile: '/tmp/capture.jsonl',
      onMiss: 'passthrough',
      routes: [
        {
          path: '/v1',
          target: 'https://api.poe.com',
          mode: 'playback',
        },
      ],
    };

    const readFile = vi.fn().mockResolvedValue(JSON.stringify(configFromFile));

    const config = await parseProxyConfigFromArgs(['--config', '/tmp/proxy-config.json'], {
      readFile,
    });

    expect(readFile).toHaveBeenCalledWith('/tmp/proxy-config.json', 'utf8');
    expect(config).toEqual(configFromFile);
  });

  it('defaults onMiss to error in JSON config', async () => {
    const configFromFile = {
      port: 4000,
      captureFile: '/tmp/capture.jsonl',
      routes: [
        {
          path: '/v1',
          target: 'https://api.poe.com',
          mode: 'playback',
        },
      ],
    };

    const readFile = vi.fn().mockResolvedValue(JSON.stringify(configFromFile));

    const config = await parseProxyConfigFromArgs(['--config', '/tmp/proxy-config.json'], {
      readFile,
    });

    expect(config.onMiss).toBe('error');
  });

  it('throws when --route has invalid format', async () => {
    await expect(
      parseProxyConfigFromArgs([
        '--port',
        '3456',
        '--capture',
        '/tmp/proxy-capture.jsonl',
        '--route',
        '/v1/chat/completions=playback',
      ]),
    ).rejects.toThrow(
      "Invalid --route format. Expected '/path=mode:/snapshotDir'.",
    );
  });

  it('rejects passthrough as route mode', async () => {
    await expect(
      parseProxyConfigFromArgs([
        '--port',
        '3456',
        '--capture',
        '/tmp/proxy-capture.jsonl',
        '--route',
        '/v1/chat/completions=passthrough:/tmp/proxy-snapshots',
      ]),
    ).rejects.toThrow('Invalid route mode: passthrough');
  });
});

describe('runProxyCli', () => {
  it('returns success for --help', async () => {
    const exitCode = await runProxyCli(['--help']);
    expect(exitCode).toBe(0);
  });

  it('starts proxy server with parsed config from flags', async () => {
    const close = vi.fn().mockResolvedValue(undefined);
    const startProxyServer = vi.fn().mockResolvedValue({
      url: 'http://127.0.0.1:3456',
      close,
    });
    const stdout = { write: vi.fn() };
    const waitForShutdown = vi.fn(async (shutdown: () => Promise<void>) => {
      await shutdown();
    });

    const exitCode = await runProxyCli(
      [
        '--port',
        '3456',
        '--capture',
        '/tmp/proxy-capture.jsonl',
        '--route',
        '/v1/chat/completions=playback:/tmp/proxy-snapshots',
      ],
      { startProxyServer, stdout, waitForShutdown },
    );

    expect(exitCode).toBe(0);
    expect(waitForShutdown).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
    expect(startProxyServer).toHaveBeenCalledWith({
      port: 3456,
      captureFile: '/tmp/proxy-capture.jsonl',
      onMiss: 'error',
      routes: [
        {
          path: '/v1/chat/completions',
          mode: 'playback',
          snapshotDir: '/tmp/proxy-snapshots',
          target: 'https://api.poe.com',
        },
      ],
    });
    expect(stdout.write).toHaveBeenCalledWith(
      'Proxy server listening on http://127.0.0.1:3456\n',
    );
  });
});

describe('isCliInvocation', () => {
  it('matches direct module invocation', () => {
    expect(
      isCliInvocation(
        ['/usr/bin/node', '/workspace/dist/proxy-cli.js'],
        'file:///workspace/dist/proxy-cli.js',
      ),
    ).toBe(true);
  });

  it('matches symlinked binary invocation by resolving realpath', () => {
    expect(
      isCliInvocation(
        ['/usr/bin/node', '/usr/local/bin/proxy-server'],
        'file:///usr/local/lib/node_modules/@poe-code/e2e-docker-test-runner/dist/proxy-cli.js',
        () => '/usr/local/lib/node_modules/@poe-code/e2e-docker-test-runner/dist/proxy-cli.js',
      ),
    ).toBe(true);
  });
});
