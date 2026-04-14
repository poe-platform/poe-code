import { createEnvContainer } from './env-container.js';
import { createPersistentContainer } from './persistent-container.js';
import type { Container, ContainerOptions } from './types.js';

export type Backend = 'env' | 'sandbox' | 'podman' | 'docker';

export function resolveBackend(): Backend {
  const explicit = process.env.E2E_BACKEND;
  if (
    explicit === 'env' ||
    explicit === 'sandbox' ||
    explicit === 'podman' ||
    explicit === 'docker'
  ) {
    return explicit;
  }
  if (explicit) {
    throw new Error(`Unsupported E2E_BACKEND: ${explicit}`);
  }
  if (process.env.CI) {
    return 'env';
  }
  return 'sandbox';
}

export async function createBackendContainer(
  backend: Backend,
  options: ContainerOptions = {},
): Promise<Container> {
  switch (backend) {
    case 'podman':
    case 'docker':
      return createPersistentContainer(options);
    case 'env':
      return createEnvContainer(options);
    case 'sandbox':
      throw new Error(`${backend} backend not implemented yet`);
    default:
      throw new Error(`Unsupported backend: ${String(backend)}`);
  }
}
