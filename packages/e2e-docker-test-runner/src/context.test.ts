import { afterAll, beforeEach, describe, expect, it, mock, vi } from 'bun:test';
import { setResolvedContext, getResolvedContext, buildContextArgs, detectRunningContext } from './context.js';

vi.mock('node:child_process', () => ({
  execSync: vi.fn(),
}));

describe('resolved context store', () => {
  beforeEach(() => {
    setResolvedContext(null);
  });

  it('returns null when explicitly set to null', () => {
    expect(getResolvedContext()).toBeNull();
  });

  it('stores and retrieves context', () => {
    setResolvedContext('colima-test');
    expect(getResolvedContext()).toBe('colima-test');
  });

  it('clears context with null', () => {
    setResolvedContext('colima-test');
    setResolvedContext(null);
    expect(getResolvedContext()).toBeNull();
  });
});

describe('detectRunningContext', () => {
  it('returns context for running docker profile', async () => {
    const { execSync } = await import('node:child_process');
    vi.mocked(execSync).mockReturnValue(
      '{"name":"poe-runner","status":"Running","runtime":"docker"}\n'
    );
    expect(detectRunningContext()).toBe('colima-poe-runner');
  });

  it('returns colima for default running profile', async () => {
    const { execSync } = await import('node:child_process');
    vi.mocked(execSync).mockReturnValue(
      '{"name":"default","status":"Running","runtime":"docker"}\n'
    );
    expect(detectRunningContext()).toBe('colima');
  });

  it('ignores stopped profiles', async () => {
    const { execSync } = await import('node:child_process');
    vi.mocked(execSync).mockReturnValue(
      '{"name":"default","status":"Stopped","runtime":"docker"}\n'
    );
    expect(detectRunningContext()).toBeNull();
  });

  it('ignores non-docker runtimes', async () => {
    const { execSync } = await import('node:child_process');
    vi.mocked(execSync).mockReturnValue(
      '{"name":"k8s","status":"Running","runtime":"containerd"}\n'
    );
    expect(detectRunningContext()).toBeNull();
  });

  it('returns null when colima is not installed', async () => {
    const { execSync } = await import('node:child_process');
    vi.mocked(execSync).mockImplementation(() => { throw new Error('command not found'); });
    expect(detectRunningContext()).toBeNull();
  });

  it('picks first running docker profile from multiple', async () => {
    const { execSync } = await import('node:child_process');
    vi.mocked(execSync).mockReturnValue(
      '{"name":"default","status":"Stopped","runtime":"docker"}\n' +
      '{"name":"test-runner","status":"Running","runtime":"docker"}\n'
    );
    expect(detectRunningContext()).toBe('colima-test-runner');
  });
});

describe('buildContextArgs', () => {
  it('returns context args for docker with context', () => {
    expect(buildContextArgs('docker', 'colima-test')).toEqual(['--context', 'colima-test']);
  });

  it('returns empty array for docker without context', () => {
    expect(buildContextArgs('docker', null)).toEqual([]);
  });

  it('returns empty array for podman even with context', () => {
    expect(buildContextArgs('podman', 'colima-test')).toEqual([]);
  });
});

afterAll(() => {
  mock.restore();
  vi.resetModules();
});
