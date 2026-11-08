import { createHash } from 'node:crypto';
import { lstat, readFile, realpath } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export function requireFact(condition, message) {
  if (!condition) throw Object.assign(new Error(message), { unsafe: true });
}

export function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

export function canonical(value) {
  function ordered(entry) {
    if (Array.isArray(entry)) return entry.map(ordered);
    if (entry !== null && typeof entry === 'object') {
      return Object.fromEntries(Object.keys(entry).sort().map(key => [key, ordered(entry[key])]));
    }
    return entry;
  }
  return JSON.stringify(ordered(value));
}

export function inside(root, location) {
  if (!isAbsolute(root) || !isAbsolute(location) || resolve(location) !== location) return false;
  const suffix = relative(root, location);
  return suffix !== '' && suffix !== '..' && !suffix.startsWith(`..${sep}`) && !isAbsolute(suffix);
}

export async function directory(location) {
  requireFact(typeof location === 'string' && isAbsolute(location), 'Absolute directory required');
  const metadata = await lstat(location);
  requireFact(metadata.isDirectory() && !metadata.isSymbolicLink() && await realpath(location) === location, 'Canonical regular directory required');
  return location;
}

export async function regularBytes(location, maximum, expected = null) {
  requireFact(typeof location === 'string' && isAbsolute(location), 'Absolute regular file required');
  const before = await lstat(location);
  requireFact(before.isFile() && !before.isSymbolicLink() && before.size <= maximum && await realpath(location) === location, 'Bounded regular file required');
  const bytes = await readFile(location);
  const after = await lstat(location);
  requireFact(after.isFile() && before.dev === after.dev && before.ino === after.ino && before.size === after.size && bytes.length === after.size && before.mode === after.mode, 'File identity changed during read');
  if (expected) requireFact(bytes.length === expected.bytes && sha256(bytes) === expected.sha256 && (after.mode & 4095) === expected.mode, 'File descriptor mismatch');
  return bytes;
}

export async function ownProjection(name) {
  requireFact(/^(?:fixtures\/[a-z-]+\.mts\.data|maps\/[a-z-]+\.json|TYPE-PLAN\.json|MUTANT-PLAN\.json)$/.test(name), 'Unknown worker projection');
  const base = fileURLToPath(new URL('.', import.meta.url));
  const sealBytes = await regularBytes(join(base, 'INPUT-PRESEAL.json'), 1048576);
  const seal = JSON.parse(sealBytes.toString('utf8'));
  const descriptor = seal.files[name];
  requireFact(descriptor?.kind === 'file' && descriptor.mode === 420, 'Unsealed active projection');
  return regularBytes(join(base, name), 1048576, descriptor);
}

export async function readPlan(api, name, filename) {
  const own = JSON.parse((await ownProjection(filename)).toString('utf8'));
  const bound = await api.readBoundJson(name);
  requireFact(canonical(own) === canonical(bound), 'Core plan differs from sealed worker projection');
  return own;
}

export function validateApi(api) {
  requireFact(api?.version === 'yq-b8-core-worker-v1', 'Committed core v1 required');
  for (const method of ['phase', 'note', 'writeJson', 'runTool', 'materializePackage', 'captureSemantic', 'assertProjection', 'guard', 'readBoundJson']) {
    requireFact(typeof api[method] === 'function', `Missing core capability ${method}`);
  }
  const request = api.request;
  requireFact(request?.schema === 1 && Object.isFrozen(request) && Object.isFrozen(request.bindings), 'Frozen core request required');
  requireFact(request.bindings.candidate === 'b8f5d60d75452e1dd181167fb87abd995221f6e3', 'Wrong candidate');
  requireFact(typeof request.nonce === 'string' && request.nonce.length >= 16, 'Missing core nonce');
  for (const name of ['rootGoSha256', 'recipeSha256']) requireFact(/^[a-f0-9]{64}$/.test(request[name] ?? '') && !/^0+$/.test(request[name]), `Missing ${name}`);
  for (const name of ['globalNs', 'phaseNs', 'jobNs', 'workNs']) requireFact(/^[1-9][0-9]*$/.test(request.deadline?.[name] ?? ''), 'Missing absolute deadline');
  requireFact(['globalNs', 'phaseNs', 'jobNs'].every(name => BigInt(request.deadline.workNs) <= BigInt(request.deadline[name])), 'Invalid work deadline');
  requireFact(typeof request.job?.id === 'string', 'Missing exact job identity');
  return request;
}

export async function guard(api) {
  requireFact((await api.guard())?.integrity === true, 'Core integrity not positive');
}

export async function checkedMaterialization(api, slot, variant = null) {
  const materialization = await api.materializePackage({ environment: slot.environment, variant: variant?.coreVariant ?? null });
  requireFact(materialization.environment === slot.environment && materialization.variantId === (variant?.id ?? null), 'Materialization profile mismatch');
  await directory(materialization.root);
  const expected = JSON.parse((await ownProjection(variant?.fullMap ?? 'maps/pristine.json')).toString('utf8'));
  requireFact(canonical(materialization.manifest) === canonical(expected), 'Complete materialization map mismatch');
  requireFact(materialization.entry === join(materialization.root, 'dist/commands/yq/index.js'), 'Wrong materialized entry');
  await regularBytes(materialization.entry, 16777216, expected.files['dist/commands/yq/index.js']);
  await regularBytes(join(materialization.root, 'README.md'), 16777216, expected.files['README.md']);
  await guard(api);
  return materialization;
}

export async function captureIdentity(api, capturePath) {
  requireFact(inside(api.request.evidenceRoot, capturePath), 'Capture outside bound evidence root');
  const bytes = await regularBytes(capturePath, 16777216);
  return { path: capturePath, sha256: sha256(bytes), bytes: bytes.length };
}

export async function finish(api, result) {
  await api.phase('cleanup');
  await guard(api);
  await api.phase('complete', { status: result.status, proofRole: result.proofRole });
  return result;
}
