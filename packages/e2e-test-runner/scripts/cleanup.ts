#!/usr/bin/env node
import { resolveBackend } from '../src/backend.js';
import { cleanupDisk } from '../src/cleanup.js';

async function main() {
  const aggressive = process.argv.includes('--aggressive') || process.argv.includes('-a');
  const clearLocalCache = !process.argv.includes('--no-cache');
  const backend = resolveBackend();
  const summary = await cleanupDisk({ aggressive, backend, clearLocalCache });

  if (backend === 'podman') {
    if (summary.orphanedContainers === 0) {
      console.log('No orphaned e2e containers found.');
    } else {
      console.log(`Cleaned up ${summary.orphanedContainers} orphaned container(s).`);
    }

    if (summary.removedE2eImages === 0) {
      console.log('No removable e2e images found.');
    } else {
      console.log(`Removed ${summary.removedE2eImages} e2e image(s).`);
    }
  } else {
    console.log(`Backend "${backend}" does not create persistent container artifacts.`);
  }

  if (summary.localCacheCleared) {
    console.log('Cleared local e2e cache (~/.cache/poe-e2e).');
  } else {
    console.log('Skipped local e2e cache cleanup.');
  }

  if (summary.aggressive) {
    console.log(
      backend === 'podman'
        ? 'Aggressive cleanup applied (image/builder/volume prune).'
        : `Aggressive cleanup is only relevant for the podman backend; nothing extra to prune for "${backend}".`,
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
