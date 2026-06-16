import { afterEach, describe, expect, it } from 'vitest';
import { buildSandboxCommand } from './sandbox.js';

const originalPlatform = process.platform;

function setPlatform(platform: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', {
    configurable: true,
    value: platform,
  });
}

afterEach(() => {
  setPlatform(originalPlatform);
});

describe('buildSandboxCommand', () => {
  it('generates a sandbox-exec profile on macOS with writable paths and env vars', () => {
    setPlatform('darwin');

    const command = buildSandboxCommand(
      {
        home: '/tmp/poe-e2e-home',
        writablePaths: ['/tmp/custom-write'],
        env: {
          FOO: 'bar',
          HELLO: 'world',
        },
      },
      'poe-code install goose',
    );

    expect(command.bin).toBe('sandbox-exec');
    expect(command.args).toEqual([
      '-p',
      `(version 1)\n(deny default)\n(allow process*)\n(allow sysctl*)\n(allow mach*)\n(allow signal)\n(allow file-read*)\n(allow network*)\n(allow file-write* (subpath "/tmp/poe-e2e-home"))\n(allow file-write* (subpath "/tmp/custom-write"))\n(allow file-write* (subpath "/dev"))\n(allow file-write* (subpath "/private/var/folders"))\n`,
      'env',
      'HOME=/tmp/poe-e2e-home',
      'FOO=bar',
      'HELLO=world',
      'sh',
      '-c',
      'poe-code install goose',
    ]);
  });

  it('generates bubblewrap args on Linux with writable paths and env vars', () => {
    setPlatform('linux');

    const command = buildSandboxCommand(
      {
        home: '/tmp/poe-e2e-home',
        writablePaths: ['/tmp/custom-write'],
        env: {
          FOO: 'bar',
          HELLO: 'world',
        },
      },
      'poe-code install goose',
    );

    expect(command).toEqual({
      bin: 'bwrap',
      args: [
        '--ro-bind',
        '/',
        '/',
        '--dev',
        '/dev',
        '--proc',
        '/proc',
        '--tmpfs',
        '/tmp',
        '--bind',
        '/tmp/poe-e2e-home',
        '/tmp/poe-e2e-home',
        '--bind',
        '/tmp/custom-write',
        '/tmp/custom-write',
        '--setenv',
        'HOME',
        '/tmp/poe-e2e-home',
        '--setenv',
        'FOO',
        'bar',
        '--setenv',
        'HELLO',
        'world',
        '--die-with-parent',
        '--',
        'sh',
        '-c',
        'poe-code install goose',
      ],
    });
  });

  it('prefers config.home over env HOME and skips blank or duplicate writable paths', () => {
    setPlatform('linux');

    const command = buildSandboxCommand(
      {
        home: '/tmp/poe-e2e-home',
        writablePaths: ['', '/tmp/poe-e2e-home', '/tmp/custom-write', '/tmp/custom-write'],
        env: {
          HOME: '/tmp/ignored-home',
          FOO: 'bar',
        },
      },
      'poe-code install goose',
    );

    expect(command.args).toContain('--setenv');
    expect(command.args).toContain('HOME');
    expect(command.args).toContain('/tmp/poe-e2e-home');
    expect(command.args).not.toContain('/tmp/ignored-home');
    expect(command.args).not.toContain('');
    expect(command.args.filter((arg) => arg === '--bind')).toHaveLength(2);
    expect(command.args).toEqual([
      '--ro-bind',
      '/',
      '/',
      '--dev',
      '/dev',
      '--proc',
      '/proc',
      '--tmpfs',
      '/tmp',
      '--bind',
      '/tmp/poe-e2e-home',
      '/tmp/poe-e2e-home',
      '--bind',
      '/tmp/custom-write',
      '/tmp/custom-write',
      '--setenv',
      'HOME',
      '/tmp/poe-e2e-home',
      '--setenv',
      'FOO',
      'bar',
      '--die-with-parent',
      '--',
      'sh',
      '-c',
      'poe-code install goose',
    ]);
  });

  it('mounts Linux tmpfs before writable paths so /tmp homes stay visible', () => {
    setPlatform('linux');

    const command = buildSandboxCommand(
      {
        home: '/tmp/poe-e2e-home',
        writablePaths: ['/tmp'],
        env: {},
      },
      'node --version',
    );
    const tmpfsIndex = command.args.findIndex(
      (arg, index, args) => arg === '--tmpfs' && args[index + 1] === '/tmp',
    );
    const homeBindIndex = command.args.findIndex(
      (arg, index, args) => arg === '--bind' && args[index + 1] === '/tmp/poe-e2e-home',
    );
    const tmpBindIndex = command.args.findIndex(
      (arg, index, args) => arg === '--bind' && args[index + 1] === '/tmp',
    );

    expect(tmpfsIndex).toBeGreaterThan(-1);
    expect(homeBindIndex).toBeGreaterThan(tmpfsIndex);
    expect(tmpBindIndex).toBeGreaterThan(tmpfsIndex);
  });

  it('escapes macOS writable paths and does not duplicate system writable paths', () => {
    setPlatform('darwin');

    const command = buildSandboxCommand(
      {
        home: '/tmp/poe-e2e-home',
        writablePaths: ['', '/tmp/quo"te', '/tmp/back\\slash', '/dev', '/dev'],
        env: {
          HOME: '/tmp/ignored-home',
          FOO: 'bar',
        },
      },
      'poe-code install goose',
    );

    expect(command.bin).toBe('sandbox-exec');
    expect(command.args[1]).toContain('(allow file-write* (subpath "/tmp/quo\\"te"))');
    expect(command.args[1]).toContain('(allow file-write* (subpath "/tmp/back\\\\slash"))');
    expect(command.args[1]).not.toContain('(allow file-write* (subpath ""))');
    expect(command.args[1].match(/\(allow file-write\* \(subpath "\/dev"\)\)/g)).toHaveLength(1);
    expect(command.args.slice(2, 5)).toEqual(['env', 'HOME=/tmp/poe-e2e-home', 'FOO=bar']);
  });

  it('throws on unsupported platforms', () => {
    setPlatform('win32');

    expect(() =>
      buildSandboxCommand(
        {
          home: '/tmp/poe-e2e-home',
          writablePaths: [],
          env: {},
        },
        'poe-code install goose',
      ),
    ).toThrow('Unsupported sandbox platform: win32');
  });
});
