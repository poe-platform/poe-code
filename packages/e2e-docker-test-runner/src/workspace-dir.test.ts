import { beforeEach, describe, expect, it, mock, vi } from 'bun:test';
import { vol } from 'memfs';

let resolveWorkspaceDir: typeof import('./container.js').resolveWorkspaceDir;

beforeEach(async () => {
  mock.restore();
  vol.reset();

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const memfs = require('memfs').fs;
  mock.module('node:fs', () => ({
    ...require('node:fs'),
    existsSync: memfs.existsSync.bind(memfs),
    readFileSync: memfs.readFileSync.bind(memfs),
  }));

  ({ resolveWorkspaceDir } = await import('./container.js'));
});

describe('resolveWorkspaceDir', () => {
  it('finds the monorepo root when started from the e2e directory', () => {
    vol.fromJSON({
      '/repo/package.json': JSON.stringify({ workspaces: ['packages/*'] }),
      '/repo/turbo.json': '{}',
      '/repo/e2e/setup.ts': '',
    });

    expect(resolveWorkspaceDir('/repo/e2e')).toBe('/repo');
  });

  it('falls back to the nearest package when no workspace root exists', () => {
    vol.fromJSON({
      '/repo/packages/runner/package.json': JSON.stringify({ name: 'runner' }),
      '/repo/packages/runner/src/index.ts': '',
    });

    expect(resolveWorkspaceDir('/repo/packages/runner/src')).toBe('/repo/packages/runner');
  });
});
