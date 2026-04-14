import { execSync } from 'node:child_process';
import { createEnvContainer } from './env-container.js';
import { createPersistentContainer } from './persistent-container.js';
import { createSandboxContainer } from './sandbox-container.js';
import type { Container, ContainerOptions } from './types.js';

export type Backend = 'env' | 'sandbox' | 'podman';

function hasSandboxRuntime(): boolean {
  const command = process.platform === 'darwin'
    ? 'sandbox-exec -V'
    : process.platform === 'linux'
      ? 'bwrap --version'
      : null;

  if (!command) {
    return false;
  }

  try {
    execSync(command, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

export function resolveBackend(): Backend {
  const explicit = process.env.E2E_BACKEND;
  if (explicit === 'env' || explicit === 'sandbox' || explicit === 'podman') {
    return explicit;
  }
  if (explicit) {
    throw new Error(`Unsupported E2E_BACKEND: ${explicit}`);
  }
  if (process.env.CI) {
    return 'env';
  }
  return hasSandboxRuntime() ? 'sandbox' : 'env';
}

export async function createBackendContainer(
  backend: Backend,
  options: ContainerOptions = {},
): Promise<Container> {
  switch (backend) {
    case 'podman':
      return createPersistentContainer(options);
    case 'env':
      return createEnvContainer(options);
    case 'sandbox':
      return createSandboxContainer(options);
    default:
      throw new Error(`Unsupported backend: ${String(backend)}`);
  }
}
