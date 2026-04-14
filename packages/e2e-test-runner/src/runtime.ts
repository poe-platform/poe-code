import { homedir } from 'node:os';
import { join } from 'node:path';

export const MOUNT_TARGET = '/workspace';
export const CONTAINER_HOME = '/home/poe';
export const E2E_CACHE_ROOT = join(homedir(), '.cache', 'poe-e2e');
export const NPM_CACHE_DIR = join(E2E_CACHE_ROOT, 'root-npm');
export const UV_CACHE_DIR = join(E2E_CACHE_ROOT, 'root-cache-uv');

let workspaceDir: string | null = null;

export function setWorkspaceDir(dir: string): void {
  workspaceDir = dir;
}

export function getWorkspaceDir(): string | null {
  return workspaceDir;
}
