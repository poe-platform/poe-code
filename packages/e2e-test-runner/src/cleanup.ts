import { execSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { detectEngine } from './engine.js';
import { cleanupOrphans } from './preflight.js';
import { E2E_CACHE_ROOT } from './runtime.js';
import type { Engine } from './types.js';

const IMAGE_NAME = 'poe-code-e2e';

export interface CleanupDiskOptions {
  aggressive?: boolean;
  clearLocalCache?: boolean;
  engine?: Engine;
}

export interface CleanupDiskResult {
  orphanedContainers: number;
  removedE2eImages: number;
  localCacheCleared: boolean;
  aggressive: boolean;
}

export async function cleanupDisk(
  options: CleanupDiskOptions = {},
): Promise<CleanupDiskResult> {
  const engine = options.engine ?? detectEngine();
  const aggressive = options.aggressive ?? false;
  const clearLocalCache = options.clearLocalCache ?? true;

  const orphanedContainers = await cleanupOrphans(engine);
  const removedE2eImages = removeE2eImages(engine);
  pruneContainerArtifacts(engine, aggressive);

  if (clearLocalCache) {
    rmSync(E2E_CACHE_ROOT, { recursive: true, force: true });
  }

  return {
    orphanedContainers,
    removedE2eImages,
    localCacheCleared: clearLocalCache,
    aggressive,
  };
}

function removeE2eImages(engine: Engine): number {
  let images: string[] = [];
  try {
    const output = execSync(
      `${engine} images --format "{{.Repository}}:{{.Tag}}" ${IMAGE_NAME}`,
      { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'] },
    );
    images = output.trim().split('\n').filter(Boolean);
  } catch {
    return 0;
  }

  let removed = 0;
  for (const image of images) {
    try {
      execSync(`${engine} rmi ${image}`, { stdio: 'ignore' });
      removed += 1;
    } catch {
      // Ignore images currently in use.
    }
  }
  return removed;
}

function pruneContainerArtifacts(engine: Engine, aggressive: boolean): void {
  const commands = aggressive
    ? [
        `${engine} image prune -af`,
        `${engine} builder prune -af`,
        `${engine} volume prune -f`,
      ]
    : [
        `${engine} image prune -f`,
        `${engine} builder prune -f`,
      ];

  for (const command of commands) {
    try {
      execSync(command, { stdio: 'ignore' });
    } catch {
      // Best-effort cleanup only.
    }
  }
}
