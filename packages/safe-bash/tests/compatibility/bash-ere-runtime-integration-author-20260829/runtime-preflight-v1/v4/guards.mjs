import * as fs from 'node:fs';
import { createHash } from 'node:crypto';
export function own(value, keys) {
  if (value === null || typeof value !== 'object') throw new Error('record required');
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const actual = Reflect.ownKeys(descriptors);
  if (actual.length !== keys.length || actual.some((key, index) => key !== keys[index])) throw new Error('exact own-key order');
  for (const key of keys) if (!Object.hasOwn(descriptors[key], 'value')) throw new Error('accessor refused');
  return value;
}
export function boundFile(binding, cap = 2097152) {
  own(binding, ['path', 'size', 'mode', 'sha256']);
  if (typeof binding.path !== 'string' || !binding.path.startsWith('/private/tmp/') || binding.path.split('/').includes('..')) throw new Error('canonical private file');
  if (!Number.isSafeInteger(binding.size) || binding.size < 0 || binding.size > cap || !Number.isInteger(binding.mode) || !/^[a-f0-9]{64}$/.test(binding.sha256)) throw new Error('file schema');
  const stat = fs.lstatSync(binding.path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== binding.size || (stat.mode & 511) !== binding.mode) throw new Error('file shape/mode/size');
  const bytes = fs.readFileSync(binding.path);
  if (bytes.length !== binding.size || createHash('sha256').update(bytes).digest('hex') !== binding.sha256) throw new Error('file hash');
  return bytes;
}
export function options(value, limits) {
  own(value, ['workerData', 'env', 'execArgv', 'stdout', 'stderr', 'resourceLimits']);
  own(value.workerData, ['operation', 'version']); own(value.env, []);
  own(value.resourceLimits, ['maxOldGenerationSizeMb', 'stackSizeMb']);
  if (value.workerData.operation !== 'shell-ere' || value.workerData.version !== 1 || !Array.isArray(value.execArgv) || Reflect.ownKeys(value.execArgv).join(',') !== 'length' || value.stdout !== true || value.stderr !== true) throw new Error('Worker options');
  if (value.resourceLimits.maxOldGenerationSizeMb !== limits.maxOldGenerationSizeMb || value.resourceLimits.stackSizeMb !== limits.stackSizeMb) throw new Error('Worker resources');
}
export function witness(value) {
  own(value, ['core70', 'kind', 'ordinal']);
  if (value.core70 !== 4 || value.kind !== 'matcher-checkpoint' || value.ordinal !== 1) throw new Error('witness identity');
}
export function deferred(milliseconds = 4500) {
  if (!Number.isSafeInteger(milliseconds) || milliseconds < 1 || milliseconds > 5000) throw new Error('finite wait cap');
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  void promise.catch(() => {});
  const timer = setTimeout(() => reject(new Error('bounded observer wait expired')), milliseconds);
  return { promise, resolve(value) { clearTimeout(timer); resolve(value); }, reject(reason) { clearTimeout(timer); reject(reason); }, cancel() { clearTimeout(timer); reject(new Error('observer wait cancelled')); } };
}
export function terminalOutcome(failed, cleanupFailed, primary) {
  if (typeof failed !== 'boolean' || typeof cleanupFailed !== 'boolean') throw new TypeError('failure presence');
  return { status: failed ? 'FAIL' : 'PASS', retired: !cleanupFailed, primary };
}
