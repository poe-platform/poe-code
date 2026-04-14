import { execSync } from 'node:child_process';
import type { Engine } from './types.js';

export function detectEngine(): Engine {
  if (isCommandAvailable('docker')) {
    return 'docker';
  }
  if (isCommandAvailable('podman')) {
    return 'podman';
  }
  throw new Error(
    'No container engine found. Please install Docker or Podman:\n' +
      '  - Docker Desktop: https://www.docker.com/products/docker-desktop\n' +
      '  - Colima (macOS): brew install colima && colima start\n' +
      '  - Podman: https://podman.io/docs/installation'
  );
}

function isCommandAvailable(command: string): boolean {
  try {
    execSync(`${command} --version`, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}
