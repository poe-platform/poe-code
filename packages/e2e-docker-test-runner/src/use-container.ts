import { beforeEach, afterEach, expect } from 'vitest';
import { createContainer } from './persistent-container.js';
import { setWorkspaceDir } from './container.js';
import type { Container } from './types.js';

export interface UseContainerOptions {
  testName: string;
  workspaceDir?: string;
}

export function useContainer(options: UseContainerOptions): Container {
  let current: Container | null = null;

  beforeEach(async () => {
    setWorkspaceDir(options.workspaceDir ?? process.cwd());
    current = await createContainer({
      testName: options.testName,
    });
    await current.login();
  });

  afterEach(async () => {
    if (current) {
      await expect(current).toHaveHealthyProxy();
      await current.destroy();
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
