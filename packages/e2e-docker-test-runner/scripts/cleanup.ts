#!/usr/bin/env node
import { cleanupDisk } from '../src/cleanup.js';

async function main() {
  const aggressive = process.argv.includes('--aggressive') || process.argv.includes('-a');
  const clearLocalCache = !process.argv.includes('--no-cache');
  const summary = await cleanupDisk({ aggressive, clearLocalCache });

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

  if (summary.localCacheCleared) {
    console.log('Cleared local e2e cache (~/.cache/poe-e2e).');
  } else {
    console.log('Skipped local e2e cache cleanup.');
  }

  if (summary.aggressive) {
    console.log('Aggressive cleanup applied (image/builder/volume prune).');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
