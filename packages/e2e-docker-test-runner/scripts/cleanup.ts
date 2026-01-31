#!/usr/bin/env node
import { cleanupOrphans } from '../src/preflight.js';

async function main() {
  const cleaned = await cleanupOrphans();

  if (cleaned === 0) {
    console.log('No orphaned containers found.');
  } else {
    console.log(`Cleaned up ${cleaned} container(s).`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
