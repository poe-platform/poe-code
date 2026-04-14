import { execSync } from 'node:child_process';
import type { Engine } from './types.js';

export function detectEngine(): Engine {
  if (isCommandAvailable('podman')) {
    return 'podman';
  }

  throw new Error(
    'Podman not installed. Install Podman: https://podman.io/docs/installation',
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
