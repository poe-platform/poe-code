import { assertOffline } from './offline.mjs';
import { writeFileSync } from 'node:fs';
import { runMutations } from './mutations.mjs';

const root = await import('virtual-bash');
const network = await import('virtual-bash/commands/network');
const results = await runMutations(root, network);
assertOffline();
writeFileSync(process.env.REVIEW_OUTPUT, JSON.stringify(results, null, 2) + '\n');
console.log(JSON.stringify({ mutations: results.mutations, detected: results.detected, executions: results.executions }));
