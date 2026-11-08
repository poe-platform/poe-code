import { assertOffline } from './offline.mjs';
import { writeFileSync } from 'node:fs';
import { runSuite } from './runtime.mjs';

const root = await import(process.env.REVIEW_ROOT_IMPORT ?? 'virtual-bash');
const network = await import(process.env.REVIEW_NETWORK_IMPORT ?? 'virtual-bash/commands/network');
const subpath = await runSuite(root, network, { baseline: process.env.REVIEW_BASELINE === '1' });
const rootSurface = await runSuite(root, root, { baseline: process.env.REVIEW_BASELINE === '1' });
const results = { counts: Object.fromEntries(Object.keys(subpath.counts).map(name => [name, subpath.counts[name] + rootSurface.counts[name]])),
  receipts: [...subpath.receipts.map(receipt => ({ ...receipt, name: `network/${receipt.name}` })),
    ...rootSurface.receipts.map(receipt => ({ ...receipt, name: `root/${receipt.name}` }))] };
assertOffline();
const receipt = { ...results, rootResolution: import.meta.resolve(process.env.REVIEW_ROOT_IMPORT ?? 'virtual-bash'),
  networkResolution: import.meta.resolve(process.env.REVIEW_NETWORK_IMPORT ?? 'virtual-bash/commands/network'),
  node: process.version, execArgv: process.execArgv, forbiddenRuntimeCalls: 0 };
writeFileSync(process.env.REVIEW_OUTPUT, JSON.stringify(receipt, null, 2) + '\n');
console.log(JSON.stringify(results.counts));
if (results.counts.failed) process.exitCode = 1;
