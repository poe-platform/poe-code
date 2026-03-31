import { describe, it, expect } from 'bun:test';
import {
  parseColimaOutput,
  findMatchingProfile,
  buildContainerScript,
  buildDockerArgs,
  MOUNT_TARGET,
  type ColimaProfile,
} from './container.js';
import { IMAGE_NAME } from './image.js';

describe('parseColimaOutput', () => {
  it('parses single profile', () => {
    const output = '{"name":"default","status":"Running","runtime":"docker"}';
    const result = parseColimaOutput(output);
    expect(result).toEqual([{ name: 'default', status: 'Running', runtime: 'docker' }]);
  });

  it('parses multiple profiles (one per line)', () => {
    const output = [
      '{"name":"default","status":"Running","runtime":"docker"}',
      '{"name":"test-runner","status":"Stopped","runtime":"docker"}',
    ].join('\n');
    const result = parseColimaOutput(output);
    expect(result).toHaveLength(2);
    expect(result[0].name).toBe('default');
    expect(result[1].name).toBe('test-runner');
  });

  it('handles empty output', () => {
    const result = parseColimaOutput('');
    expect(result).toEqual([]);
  });

  it('filters empty lines', () => {
    const output = '{"name":"default","status":"Running","runtime":"docker"}\n\n';
    const result = parseColimaOutput(output);
    expect(result).toHaveLength(1);
  });
});

describe('findMatchingProfile', () => {
  const runningDocker: ColimaProfile = { name: 'default', status: 'Running', runtime: 'docker' };
  const stoppedDocker: ColimaProfile = { name: 'test', status: 'Stopped', runtime: 'docker' };
  const runningContainerd: ColimaProfile = { name: 'k8s', status: 'Running', runtime: 'containerd' };

  it('returns null for empty profiles', () => {
    const result = findMatchingProfile([], '/path/to/workspace');
    expect(result).toBeNull();
  });

  it('prefers profile matching workspace-runner pattern', () => {
    const expectedRunner: ColimaProfile = { name: 'workspace-runner', status: 'Running', runtime: 'docker' };
    const profiles = [runningDocker, expectedRunner];
    const result = findMatchingProfile(profiles, '/path/to/workspace');
    expect(result?.profile).toBe('workspace-runner');
  });

  it('falls back to any running docker profile', () => {
    const result = findMatchingProfile([runningDocker, stoppedDocker], '/path/to/workspace');
    expect(result?.profile).toBe('default');
  });

  it('ignores stopped profiles', () => {
    const result = findMatchingProfile([stoppedDocker], '/path/to/workspace');
    expect(result).toBeNull();
  });

  it('ignores non-docker runtimes', () => {
    const result = findMatchingProfile([runningContainerd], '/path/to/workspace');
    expect(result).toBeNull();
  });

  it('generates correct context for default profile', () => {
    const result = findMatchingProfile([runningDocker], '/path/to/workspace');
    expect(result?.context).toBe('colima');
  });

  it('generates correct context for named profile', () => {
    const namedProfile: ColimaProfile = { name: 'myprofile', status: 'Running', runtime: 'docker' };
    const result = findMatchingProfile([namedProfile], '/path/to/workspace');
    expect(result?.context).toBe('colima-myprofile');
  });

  it('uses profile field if name is missing', () => {
    const profileField: ColimaProfile = { profile: 'oldstyle', status: 'Running', runtime: 'docker' };
    const result = findMatchingProfile([profileField], '/path/to/workspace');
    expect(result?.profile).toBe('oldstyle');
  });
});

describe('buildContainerScript', () => {
  it('includes set -e at the start', () => {
    const script = buildContainerScript([]);
    expect(script).toMatch(/^set -e/);
  });

  it('sets up PATH for uv binaries using non-root home', () => {
    const script = buildContainerScript([]);
    expect(script).toContain('export PATH="/home/poe/.local/bin');
  });

  it('creates poe-code logs directory in non-root home', () => {
    const script = buildContainerScript([]);
    expect(script).toContain('mkdir -p /home/poe/.poe-code/logs');
  });

  it('appends user commands at the end', () => {
    const script = buildContainerScript(['echo hello', 'echo world']);
    expect(script).toContain('echo hello');
    expect(script).toContain('echo world');
    // User commands should come after PATH setup
    const pathIndex = script.indexOf('export PATH=');
    const echoIndex = script.indexOf('echo hello');
    expect(echoIndex).toBeGreaterThan(pathIndex);
  });

  it('joins commands with semicolons', () => {
    const script = buildContainerScript(['cmd1', 'cmd2']);
    expect(script).toContain('; cmd1; cmd2');
  });
});

describe('buildDockerArgs', () => {
  const testImage = `${IMAGE_NAME}:test123`;
  const baseConfig = {
    engine: 'docker' as const,
    context: '',
    mountSource: '/workspace',
    cacheConfig: {
      npmCacheDir: '/cache/npm',
      uvCacheDir: '/cache/uv',
    },
    apiKey: null,
    containerScript: 'echo test',
    image: testImage,
  };

  it('includes run --rm', () => {
    const args = buildDockerArgs(baseConfig);
    expect(args).toContain('run');
    expect(args).toContain('--rm');
  });

  it('mounts workspace to container', () => {
    const args = buildDockerArgs(baseConfig);
    expect(args).toContain('-v');
    expect(args).toContain(`/workspace:${MOUNT_TARGET}:rw`);
  });

  it('mounts cache directories to non-root user home', () => {
    const args = buildDockerArgs(baseConfig);
    expect(args).toContain('/cache/npm:/home/poe/.npm:rw');
    expect(args).toContain('/cache/uv:/home/poe/.cache/uv:rw');
  });

  it('sets working directory', () => {
    const args = buildDockerArgs(baseConfig);
    const wIndex = args.indexOf('-w');
    expect(wIndex).toBeGreaterThan(-1);
    expect(args[wIndex + 1]).toBe(MOUNT_TARGET);
  });

  it('includes image and shell command', () => {
    const args = buildDockerArgs(baseConfig);
    expect(args).toContain(testImage);
    expect(args).toContain('sh');
    expect(args).toContain('-lc');
    expect(args).toContain('echo test');
  });

  it('adds context flag when provided for docker engine', () => {
    const args = buildDockerArgs({ ...baseConfig, context: 'colima-test' });
    const contextIndex = args.indexOf('--context');
    expect(contextIndex).toBeGreaterThan(-1);
    expect(args[contextIndex + 1]).toBe('colima-test');
  });

  it('does not add context flag for podman', () => {
    const args = buildDockerArgs({ ...baseConfig, engine: 'podman', context: 'colima-test' });
    expect(args).not.toContain('--context');
  });

  it('adds env vars when apiKey is provided', () => {
    const args = buildDockerArgs({ ...baseConfig, apiKey: 'test-key' });
    expect(args).toContain('-e');
    expect(args).toContain('POE_API_KEY');
    expect(args).toContain('POE_CODE_STDERR_LOGS=1');
  });

  it('does not add env vars when apiKey is null', () => {
    const args = buildDockerArgs(baseConfig);
    expect(args).not.toContain('POE_API_KEY');
  });
});
