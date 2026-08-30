import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';

let origin = performance.now();
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
function demand(condition, label) { if (!condition) throw new Error(label); }
const arguments_ = process.argv.slice(2);
demand(process.umask() === 0o022, 'EXPLICIT_UMASK_022_REQUIRED');
demand(arguments_.length === 4 && arguments_[0] === '--root-receipt' && arguments_[2] === '--expect-root' && /^[a-f0-9]{64}$/.test(arguments_[3]), 'DENY_EXPLICIT_ROOT_ROUTE_REQUIRED');
const scope = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const routeFile = path.resolve(arguments_[1]);
demand(await fs.realpath(routeFile) === routeFile, 'ROOT_RECEIPT_REALPATH');
const routeStat = await fs.lstat(routeFile);
demand(routeStat.isFile() && routeStat.size <= 65536, 'ROOT_RECEIPT_REGULAR_BOUNDED');
const routeBytes = await fs.readFile(routeFile);
demand(sha(routeBytes) === arguments_[3], 'ROOT_RECEIPT_EXPECTED_HASH');
const route = JSON.parse(routeBytes.toString('utf8'));
demand(JSON.stringify(Object.keys(route)) === JSON.stringify(['schema', 'recipeSha256', 'finalSealSha256', 'sourceCommit', 'derivedTree', 'packageSha256', 'componentReviews', 'outputRoot', 'originHrtimeNs', 'action']), 'ROOT_RECEIPT_KEYS_ORDER');
demand(route.schema === 'm1b-root-route-v1' && route.action === 'ONE_SCOPED_REVIEW' && route.sourceCommit === 'fca6f81d2d96db2bbceabf3247cd57ffe240bde6' && route.derivedTree === '23074ef0c443ca618c4f26204b5f3d2274b86895' && route.packageSha256 === 'cc0e75c2d0d12f713f0458e608ddeae157cf3432b4e0b48277a329a98115aa1a', 'ROOT_SOURCE_AUTHORITY');
demand(typeof route.originHrtimeNs === 'string' && /^[0-9]{1,24}$/.test(route.originHrtimeNs), 'ROOT_MONOTONIC_ORIGIN');
const elapsedNs = process.hrtime.bigint() - BigInt(route.originHrtimeNs);
demand(elapsedNs >= 0n && elapsedNs < 7200000000000n, 'ROOT_ORIGIN_EXPIRED_OR_FUTURE');
origin = performance.now() - Number(elapsedNs) / 1000000;
demand(process.execArgv.length === 0 && !process.env.NODE_OPTIONS && !process.env.NODE_PATH, 'BOOTSTRAP_STARTUP_CLOSURE');
const recipeBytes = await fs.readFile(path.join(scope, 'RECIPE.json'));
const sealBytes = await fs.readFile(path.join(scope, 'FINAL-SEAL.json'));
for (const filename of ['RECIPE.json', 'FINAL-SEAL.json']) {
  const stat = await fs.lstat(path.join(scope, filename));
  demand(stat.isFile() && !stat.isSymbolicLink() && (stat.mode & 0o777) === 0o644, 'ROOT_CONTROL_MODE');
}
demand(sha(recipeBytes) === route.recipeSha256 && sha(sealBytes) === route.finalSealSha256, 'ROOT_RECIPE_SEAL');
const recipe = JSON.parse(recipeBytes.toString('utf8'));
const seal = JSON.parse(sealBytes.toString('utf8'));
demand(recipe.schema === 'm1b-review-recipe-v1' && recipe.state === 'COMPLETE_PRESEAL' && recipe.sourceCommit === route.sourceCommit && recipe.derivedTree === route.derivedTree && recipe.packageSha256 === route.packageSha256, 'RECIPE_NOT_READY');
demand(recipe.caps.wallMs === 7200000 && recipe.caps.childStarts === 168 && recipe.caps.peakProcesses === 4 && recipe.caps.captureBytes === 268435456 && recipe.caps.workBytes === 1073741824, 'ROOT_FIXED_CAPS');
demand(Array.isArray(route.componentReviews) && recipe.requiredReviews.every(required => route.componentReviews.some(review => review.component === required.component && review.sourceSeal === required.sourceSeal && /^[a-f0-9]{40}$/.test(review.commit) && /^[a-f0-9]{64}$/.test(review.receiptSha256) && review.disposition === 'PRELAUNCH_COMPONENT_REVIEW_COMPLETE')), 'COMPONENT_REVIEW_MISSING');
const names = new Set();
for (const row of seal.files) {
  demand(typeof row.path === 'string' && !row.path.startsWith('/') && row.path.split('/').every(part => part && part !== '..' && part !== '.' && part !== 'AGENTS.md') && !names.has(row.path), 'SEAL_PATH');
  names.add(row.path);
  const filename = path.join(scope, row.path);
  demand(await fs.realpath(filename) === filename, 'SEAL_REALPATH');
  const stat = await fs.lstat(filename);
  demand(stat.isFile() && (stat.mode & 0o777) === row.mode && stat.size === row.bytes && stat.size <= 8388608, 'SEAL_FILE');
  demand(sha(await fs.readFile(filename)) === row.sha256, 'SEAL_HASH');
}
const nodeRow = recipe.bootstrapNode;
const nodeStat = await fs.lstat(process.execPath);
demand(process.execPath === nodeRow.origin && nodeStat.isFile() && (nodeStat.mode & 0o777) === nodeRow.mode && nodeStat.size === nodeRow.bytes && sha(await fs.readFile(process.execPath)) === nodeRow.sha256, 'BOOTSTRAP_NODE_IDENTITY');
const output = route.outputRoot;
demand(typeof output === 'string' && /^\/private\/tmp\/git-m1b-fca-independent-[A-Za-z0-9-]{8,80}$/.test(output), 'OWNED_OUTPUT_DOMAIN');
await fs.mkdir(output, { mode: 0o700 });
const { inventory, demand: invariant } = await import('./primitives.mjs');
const sourceRootBefore = await inventory(scope);
invariant(sourceRootBefore.filter(row => row.kind === 'file').length === seal.files.length + 1 && sourceRootBefore.every(row => row.kind === 'directory' || names.has(row.path) || row.path === 'FINAL-SEAL.json'), 'SEAL_COMPLETE_MEMBERSHIP');
const { coordinate } = await import('./coordinator.mjs');
const result = await coordinate({ recipe, root: output, origin, scope, seal, rootReceipt: route, sourceRootBefore });
process.stdout.write(JSON.stringify(result) + '\n');
process.exitCode = result.status === 'PASS_SCOPED_ONLY' ? 0 : 1;
