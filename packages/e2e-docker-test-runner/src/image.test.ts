import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  getSourceHash,
  imageExists,
  IMAGE_NAME,
  BUILD_TARBALLS,
} from './image.js';

// Mock child_process for imageExists
vi.mock('node:child_process', () => ({
  execSync: vi.fn(),
  spawnSync: vi.fn(),
}));

describe('image', () => {
  const dockerfileSource = readFileSync(new URL('../e2e.Dockerfile', import.meta.url), 'utf-8');

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('IMAGE_NAME', () => {
    it('has correct value', () => {
      expect(IMAGE_NAME).toBe('poe-code-e2e');
    });
  });

  describe('BUILD_TARBALLS', () => {
    it('includes tarballs required for proxy-server and poe-agent runtime', () => {
      const names = BUILD_TARBALLS.map((entry) => entry.name);
      expect(names).toContain('poe-code.tgz');
      expect(names).toContain('e2e-docker-test-runner.tgz');
      expect(names).toContain('poe-agent.tgz');
      expect(names).toContain('auth-store.tgz');
      expect(names).toContain('poe-oauth.tgz');
      expect(names).toContain('agent-spawn.tgz');
      expect(names).toContain('agent-defs.tgz');
      expect(names).toContain('design-system.tgz');
      expect(names).toContain('tiny-mcp-client.tgz');
      expect(names).toContain('tiny-stdio-mcp-server.tgz');
      expect(names).toContain('tiny-stdio-mcp-test-server.tgz');
    });
  });

  describe('e2e.Dockerfile', () => {
    it('keeps proxy-server binary available on PATH', () => {
      expect(dockerfileSource).toContain('proxy-server --help >/dev/null');
    });

    it('verifies poe-agent can be imported in the image', () => {
      expect(dockerfileSource).toContain('node --input-type=module -e "await import.meta.resolve(\'@poe-code/poe-agent\')"');
    });
  });

  describe('getSourceHash', () => {
    it('returns a 12-character hex hash for real workspace', () => {
      // Use the actual workspace to test hash computation
      const hash = getSourceHash(process.cwd());
      expect(hash).toHaveLength(12);
      expect(hash).toMatch(/^[a-f0-9]+$/);
    });

    it('returns consistent hash for same workspace', () => {
      const hash1 = getSourceHash(process.cwd());
      const hash2 = getSourceHash(process.cwd());
      expect(hash1).toBe(hash2);
    });
  });

  describe('imageExists', () => {
    it('returns true when image exists', async () => {
      const { execSync } = await import('node:child_process');
      vi.mocked(execSync).mockReturnValue('abc123\n');

      const exists = imageExists('docker', 'poe-code-e2e:test');
      expect(exists).toBe(true);
      expect(execSync).toHaveBeenCalledWith(
        'docker images -q poe-code-e2e:test',
        expect.any(Object)
      );
    });

    it('returns false when image does not exist', async () => {
      const { execSync } = await import('node:child_process');
      vi.mocked(execSync).mockReturnValue('');

      const exists = imageExists('docker', 'poe-code-e2e:notexist');
      expect(exists).toBe(false);
    });

    it('returns false on error', async () => {
      const { execSync } = await import('node:child_process');
      vi.mocked(execSync).mockImplementation(() => {
        throw new Error('docker not found');
      });

      const exists = imageExists('docker', 'poe-code-e2e:test');
      expect(exists).toBe(false);
    });

    it('uses podman when specified', async () => {
      const { execSync } = await import('node:child_process');
      vi.mocked(execSync).mockReturnValue('abc123\n');

      imageExists('podman', 'poe-code-e2e:test');
      expect(execSync).toHaveBeenCalledWith(
        'podman images -q poe-code-e2e:test',
        expect.any(Object)
      );
    });

    it('uses context when specified for docker', async () => {
      const { execSync } = await import('node:child_process');
      vi.mocked(execSync).mockReturnValue('abc123\n');

      imageExists('docker', 'poe-code-e2e:test', 'colima-test');
      expect(execSync).toHaveBeenCalledWith(
        'docker --context colima-test images -q poe-code-e2e:test',
        expect.any(Object)
      );
    });

    it('ignores context for podman', async () => {
      const { execSync } = await import('node:child_process');
      vi.mocked(execSync).mockReturnValue('abc123\n');

      imageExists('podman', 'poe-code-e2e:test', 'colima-test');
      expect(execSync).toHaveBeenCalledWith(
        'podman images -q poe-code-e2e:test',
        expect.any(Object)
      );
    });
  });
});
