import { describe, it, expect, expectTypeOf, vi, beforeEach } from 'vitest';
import './matchers.js';

vi.mock('./persistent-container.js');
vi.mock('./container.js');

import { createContainer } from './persistent-container.js';
import { setWorkspaceDir } from './container.js';
import { useContainer } from './use-container.js';
import type { UseContainerOptions } from './use-container.js';
import type { CapturedRequests, Container } from './types.js';

function makeMockContainer(): Container {
  return {
    id: 'test-123',
    destroy: vi.fn(),
    exec: vi.fn().mockResolvedValue({ exitCode: 0, stdout: '', stderr: '' }),
    execOrThrow: vi.fn().mockResolvedValue({ exitCode: 0, stdout: '', stderr: '' }),
    login: vi.fn(),
    fileExists: vi.fn(),
    readFile: vi.fn(),
    writeFile: vi.fn(),
    proxyLog: vi.fn().mockResolvedValue(null),
    requests: vi.fn().mockResolvedValue({ length: 0 } as CapturedRequests),
    writeSnapshots: vi.fn().mockResolvedValue(undefined),
  };
}

describe('useContainer', () => {
  let mockContainer: Container;

  beforeEach(() => {
    vi.clearAllMocks();
    mockContainer = makeMockContainer();
    vi.mocked(createContainer).mockResolvedValue(mockContainer);
  });

  it('defines options with required testName and optional workspaceDir', () => {
    expectTypeOf<UseContainerOptions>().toEqualTypeOf<{
      testName: string;
      workspaceDir?: string;
    }>();
  });

  it('defines container proxy helper method types', () => {
    expectTypeOf<Container>().toMatchTypeOf<{
      requests: () => Promise<CapturedRequests>;
      writeSnapshots: (
        snapshots: Array<{ key: string; response: unknown }>
      ) => Promise<void>;
    }>();
  });

  describe('lifecycle', () => {
    const container = useContainer({
      testName: 'my-agent',
      workspaceDir: '/test',
    });

    it('sets workspace dir', () => {
      expect(setWorkspaceDir).toHaveBeenCalledWith('/test');
    });

    it('creates container with testName', () => {
      expect(createContainer).toHaveBeenCalledWith({
        testName: 'my-agent',
      });
    });

    it('logs in', () => {
      expect(mockContainer.login).toHaveBeenCalled();
    });

    it('delegates exec to container', async () => {
      vi.mocked(mockContainer.exec).mockResolvedValue({ exitCode: 0, stdout: 'hello', stderr: '' });
      const result = await container.exec('echo hello');
      expect(mockContainer.exec).toHaveBeenCalledWith('echo hello');
      expect(result.stdout).toBe('hello');
    });

    it('exposes container id', () => {
      expect(container.id).toBe('test-123');
    });

    it('delegates requests to container', async () => {
      const capturedRequests = {
        length: 1,
      } as CapturedRequests;
      vi.mocked(mockContainer.requests).mockResolvedValue(capturedRequests);

      const result = await container.requests();

      expect(mockContainer.requests).toHaveBeenCalledTimes(1);
      expect(result).toBe(capturedRequests);
    });

    it('delegates writeSnapshots to container', async () => {
      const snapshots = [{ key: 'snapshot-key', response: { id: 'res' } }];

      await container.writeSnapshots(snapshots);

      expect(mockContainer.writeSnapshots).toHaveBeenCalledWith(snapshots);
    });

    it('creates a fresh container for each test', () => {
      expect(vi.mocked(createContainer)).toHaveBeenCalledTimes(1);
    });
  });
});
