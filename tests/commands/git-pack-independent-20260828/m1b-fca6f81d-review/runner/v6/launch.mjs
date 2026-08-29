import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { fileURLToPath, pathToFileURL } from 'node:url';

const sha = body => createHash('sha256').update(body).digest('hex');
function demand(condition, label) { if (!condition) throw new Error(label); }
function relative(name) { demand(typeof name === 'string' && name.length <= 1024 && !name.startsWith('/') && !name.includes('\\') && name.split('/').every(part => part && part !== '.' && part !== '..' && part !== 'AGENTS.md'), 'SELECTED_PATH'); return name; }
async function file(filename, expected) {
  demand(await fs.realpath(filename) === filename, 'SELECTED_REALPATH');
  const before = await fs.lstat(filename);
  demand(before.isFile() && !before.isSymbolicLink() && before.size <= 8388608, 'SELECTED_REGULAR_BOUND');
  if (expected) demand(before.size === expected.bytes && (before.mode & 0o777) === expected.mode, 'SELECTED_MODE_SIZE');
  const body = await fs.readFile(filename);
  const after = await fs.lstat(filename);
  demand(before.dev === after.dev && before.ino === after.ino && before.size === after.size && before.mode === after.mode && before.mtimeMs === after.mtimeMs, 'SELECTED_READ_STABILITY');
  if (expected) demand(sha(body) === expected.sha256, 'SELECTED_HASH');
  return body;
}
const args = process.argv.slice(2);
demand(args.length === 4 && args[0] === '--root-receipt' && args[2] === '--expect-root' && /^[a-f0-9]{64}$/.test(args[3]) && typeof process.send === 'function', 'OUTER_OWNED_ROUTE_REQUIRED');
const scope = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const routeFilename = path.resolve(args[1]);
const routeStat = await fs.lstat(routeFilename);
demand((routeStat.mode & 0o777) === 0o600 && routeStat.size <= 65536, 'ROOT_ROUTE_MODE_SIZE');
const routeBytes = await file(routeFilename);
demand(sha(routeBytes) === args[3], 'ROUTE_RAW_HASH');
const route = JSON.parse(routeBytes.toString('utf8'));
demand(JSON.stringify(Object.keys(route)) === JSON.stringify(['schema', 'recipeSha256', 'finalSealSha256', 'sourceCommit', 'derivedTree', 'packageSha256', 'componentReviews', 'outputRoot', 'originHrtimeNs', 'action']), 'ROOT_ROUTE_KEYS_ORDER');
demand(route.schema === 'm1b-root-route-v2' && route.action === 'ONE_SCOPED_REVIEW' && route.outputRoot === process.env.M1B_OUTER_ROOT, 'ROOT_ROUTE_ROLE');
demand(route.sourceCommit === 'fca6f81d2d96db2bbceabf3247cd57ffe240bde6' && route.derivedTree === '23074ef0c443ca618c4f26204b5f3d2274b86895' && route.packageSha256 === 'cc0e75c2d0d12f713f0458e608ddeae157cf3432b4e0b48277a329a98115aa1a', 'FIXED_CANDIDATE');
demand(typeof route.originHrtimeNs === 'string' && /^[0-9]{1,24}$/.test(route.originHrtimeNs), 'ROOT_MONOTONIC_ORIGIN');
const elapsedNs = process.hrtime.bigint() - BigInt(route.originHrtimeNs);
demand(elapsedNs >= 0n && elapsedNs < 7200000000000n, 'ROOT_ORIGIN_EXPIRED');
const origin = performance.now() - Number(elapsedNs) / 1000000;
for (const name of ['RECIPE-v6.json', 'FINAL-SEAL-v6.json']) demand(((await fs.lstat(path.join(scope, name))).mode & 0o777) === 0o644, 'ROOT_CONTROL_MODE');
const recipeBytes = await file(path.join(scope, 'RECIPE-v6.json'));
const sealBytes = await file(path.join(scope, 'FINAL-SEAL-v6.json'));
demand(sha(recipeBytes) === route.recipeSha256 && sha(sealBytes) === route.finalSealSha256, 'ROOT_RECIPE_SEAL');
const recipe = JSON.parse(recipeBytes.toString('utf8'));
const seal = JSON.parse(sealBytes.toString('utf8'));
demand(recipe.schema === 'm1b-review-recipe-v2' && recipe.state === 'COMPLETE_PRESEAL' && seal.status === 'COMPLETE_SELECTED_PRESEAL', 'RECIPE_NOT_READY');
demand(recipe.caps.wallMs === 7200000 && recipe.caps.childStarts === 168 && recipe.caps.peakProcesses === 4 && recipe.caps.captureBytes === 255852544 && recipe.caps.workBytes === 1073741824 && recipe.caps.outerCaptureBytes === 4194304, 'FIXED_CAPS');
demand(Array.isArray(route.componentReviews) && recipe.requiredReviews.every(required => route.componentReviews.some(review => review.component === required.component && review.sourceSeal === required.sourceSeal && /^[a-f0-9]{40}$/.test(review.commit) && /^[a-f0-9]{64}$/.test(review.receiptSha256) && review.disposition === 'PRELAUNCH_COMPONENT_REVIEW_COMPLETE')), 'COMPONENT_REVIEW_REQUIRED');
for (const row of seal.files) await file(path.join(scope, relative(row.path)), row);
const root = route.outputRoot;
demand(await fs.realpath(root) === root && (await fs.lstat(root)).isDirectory(), 'OUTER_ROOT_REQUIRED');
const assemblyBytes = await file(path.join(scope, recipe.assembly.path), recipe.assembly);
const assembly = JSON.parse(assemblyBytes.toString('utf8'));
demand(assembly.schema === 'm1b-selected-assembly-v2' && assembly.files.length <= 128, 'ASSEMBLY_SCHEMA_BOUND');
const projection = path.join(root, 'projection');
await fs.mkdir(projection, { mode: 0o755 });
const names = new Set();
const directories = new Set();
let bootstrapWorkBytes = 0;
for (const row of assembly.files) {
  relative(row.path); relative(row.sourcePath);
  demand(!names.has(row.path) && row.sourcePath.startsWith(recipe.scope + '/') && /^[a-f0-9]{40}$/.test(row.sourceCommit) && /^[a-f0-9]{40}$/.test(row.blob), 'ASSEMBLY_SOURCE_ROLE');
  names.add(row.path);
  bootstrapWorkBytes += row.bytes;
  demand(Number.isSafeInteger(row.bytes) && row.bytes >= 0 && bootstrapWorkBytes <= 8388608, 'BOOTSTRAP_WORK_RESERVATION');
  let directory = path.posix.dirname(row.path);
  while (directory !== '.') { directories.add(directory); directory = path.posix.dirname(directory); }
}
for (const directory of [...directories].sort((left, right) => left.split('/').length - right.split('/').length || Buffer.compare(Buffer.from(left), Buffer.from(right)))) await fs.mkdir(path.join(projection, directory), { mode: 0o755 });
for (const row of assembly.files) {
  const source = path.join(recipe.repo, row.sourcePath);
  const body = await file(source, row);
  const actualBlob = createHash('sha1').update('blob ' + body.length + '\0').update(body).digest('hex');
  demand(actualBlob === row.blob, 'ASSEMBLY_STORED_BLOB_BYTES');
  const destination = path.join(projection, row.path);
  const handle = await fs.open(destination, 'wx', row.mode);
  try { await handle.chmod(row.mode); await handle.writeFile(body); await handle.sync(); } finally { await handle.close(); }
  await file(destination, row);
  await file(source, row);
}
let observedFiles = 0;
let observedDirectories = 0;
const walk = async (directory, prefix = '') => {
  for (const name of await fs.readdir(directory)) {
    const relativeName = prefix ? prefix + '/' + name : name;
    const filename = path.join(directory, name);
    const stat = await fs.lstat(filename);
    demand(!stat.isSymbolicLink(), 'PROJECTION_SYMLINK');
    if (stat.isDirectory()) { demand(directories.has(relativeName) && (stat.mode & 0o777) === 0o755, 'PROJECTION_ADDED_DIRECTORY'); observedDirectories++; await walk(filename, relativeName); }
    else { const row = assembly.files.find(value => value.path === relativeName); demand(row && stat.isFile(), 'PROJECTION_ADDED_FILE'); await file(filename, row); observedFiles++; }
  }
};
await walk(projection);
demand(observedFiles === names.size && observedDirectories === directories.size, 'PROJECTION_COMPLETE_MEMBERSHIP');
const { inventory } = await import(pathToFileURL(path.join(projection, 'runner/primitives.mjs')).href);
const projectionBefore = await inventory(projection);
const { coordinate } = await import(pathToFileURL(path.join(projection, 'runner/coordinator.mjs')).href);
const result = await coordinate({ recipe, root, origin, scope: projection, projectionBefore, bootstrapWorkBytes, rootReceipt: route });
await new Promise((resolve, reject) => process.send({ role: 'COORDINATOR_RESULT', result }, error => error ? reject(error) : resolve()));
process.stdout.write(JSON.stringify(result) + '\n');
process.exitCode = result.status === 'PASS_SCOPED_ONLY' ? 0 : 1;
process.disconnect();
