import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { admitCapturedTree } from './controller-admission.mjs';
import { bindings } from './manifest-bindings.mjs';

const own = path.dirname(fileURLToPath(import.meta.url));
export function dataAdmission(profile, manifest) {
  if (typeof profile !== 'string' || !Object.hasOwn(bindings, profile) || profile === 'future-inventory') throw new Error('finite DATA admission only');
  return admitCapturedTree(path.resolve(own, bindings[profile].directory), 'synthetic', profile, manifest);
}
