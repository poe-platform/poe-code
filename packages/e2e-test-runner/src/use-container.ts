import { beforeEach, afterEach, expect } from 'vitest';
import { createBackendContainer, resolveBackend } from './backend.js';
import { setWorkspaceDir } from './runtime.js';
import type { Container } from './types.js';

export interface UseContainerOptions {
  testName: string;
  workspaceDir?: string;
  useSnapshots?: boolean;
}

export async function cleanupContainer(container: Container): Promise<void> {
  try {
    await expect(container).toHaveHealthyProxy();
  } finally {
    await container.destroy();
  }
}

export function useContainer(options: UseContainerOptions): Container {
  let current: Container | null = null;

  beforeEach(async () => {
    setWorkspaceDir(options.workspaceDir ?? process.cwd());
    current = await createBackendContainer(resolveBackend(), {
      testName: options.testName,
      useSnapshots: options.useSnapshots ?? false,
    });
    await current.login();
  });

  afterEach(async () => {
    if (current) {
      await cleanupContainer(current);
    }
    current = null;
  });

  return new Proxy({} as Container, {
    get(_, prop: string | symbol) {
      if (!current) {
        throw new Error('Container not available outside of test lifecycle');
      }
      return current[prop as keyof Container];
    },
  });
}
