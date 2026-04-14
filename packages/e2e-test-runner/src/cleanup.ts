import { execSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { detectEngine } from './engine.js';
import { detectRunningContext } from './context.js';
import { cleanupOrphans } from './preflight.js';
import { IMAGE_NAME } from './image.js';
import { E2E_CACHE_ROOT } from './container.js';
import type { Engine } from './types.js';

export interface CleanupDiskOptions {
  aggressive?: boolean;
  clearLocalCache?: boolean;
  engine?: Engine;
  context?: string;
}

export interface CleanupDiskResult {
  orphanedContainers: number;
  removedE2eImages: number;
  localCacheCleared: boolean;
  aggressive: boolean;
}

export async function cleanupDisk(
  options: CleanupDiskOptions = {}
): Promise<CleanupDiskResult> {
  const engine = options.engine ?? detectEngine();
  const context = options.context ?? (
    engine === 'docker' ? detectRunningContext() : null
  );
  const contextArg = context ? `--context ${context}` : '';
  const aggressive = options.aggressive ?? false;
  const clearLocalCache = options.clearLocalCache ?? true;

  const orphanedContainers = await cleanupOrphans(
    engine,
    context ?? undefined
  );
  const removedE2eImages = removeE2eImages(engine, contextArg);
  pruneDockerArtifacts(engine, contextArg, aggressive);

  if (clearLocalCache) {
    rmSync(E2E_CACHE_ROOT, { recursive: true, force: true });
  }

  return {
    orphanedContainers,
    removedE2eImages,
    localCacheCleared: clearLocalCache,
    aggressive
  };
}

function removeE2eImages(engine: Engine, contextArg: string): number {
  let images: string[] = [];
  try {
    const output = execSync(
      buildCommand(
        engine,
        contextArg,
        `images --format "{{.Repository}}:{{.Tag}}" ${IMAGE_NAME}`
      ),
      { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'] }
    );
    images = output.trim().split('\n').filter(Boolean);
  } catch {
    return 0;
  }

  let removed = 0;
  for (const image of images) {
    try {
      execSync(buildCommand(engine, contextArg, `rmi ${image}`), {
        stdio: 'ignore',
      });
      removed++;
    } catch {
      // Ignore images currently in use.
    }
  }
  return removed;
}

function pruneDockerArtifacts(
  engine: Engine,
  contextArg: string,
  aggressive: boolean
): void {
  const commands = aggressive
    ? [
        buildCommand(engine, contextArg, 'image prune -af'),
        buildCommand(engine, contextArg, 'builder prune -af'),
        buildCommand(engine, contextArg, 'volume prune -f')
      ]
    : [
        buildCommand(engine, contextArg, 'image prune -f'),
        buildCommand(engine, contextArg, 'builder prune -f')
      ];

  for (const command of commands) {
    try {
      execSync(command, { stdio: 'ignore' });
    } catch {
      // Best-effort cleanup only.
    }
  }
}

function buildCommand(
  engine: Engine,
  contextArg: string,
  suffix: string
): string {
  const contextPart = contextArg.length > 0 ? `${contextArg} ` : '';
  return `${engine} ${contextPart}${suffix}`;
}
