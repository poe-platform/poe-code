import fs from 'node:fs';
import { isMainThread, threadId } from 'node:worker_threads';
fs.appendFileSync(process.env.FIXTURE_LOG, JSON.stringify({ kind: 'loader-start', isMainThread, threadId }) + '\n');
export function load() { throw Error('EARLY_LOADER_SENTINEL'); }
