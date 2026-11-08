import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { readBound, hash } from './io.mjs';

let configuration;
export function initialize(data) { configuration = data; }
function member(url) {
  if (url.startsWith('node:')) return null;
  if (!url.startsWith('file:')) throw new Error(`non-file module denied: ${url}`);
  const declared = fileURLToPath(url), filename = realpathSync(declared);
  if (declared !== filename || !configuration.files[filename]) throw new Error(`unbound module: ${url}`);
  return filename;
}
function record(value) { configuration.port.postMessage(value); }
export async function resolve(specifier, context, nextResolve) {
  const result = await nextResolve(specifier, context);
  member(result.url);
  record({ type: 'resolve-returned', specifier, parentURL: context.parentURL ?? null, url: result.url });
  return result;
}
export async function load(url, context, nextLoad) {
  const filename = member(url);
  if (filename) readBound(dirname(filename), filename, configuration.files[filename], undefined, false);
  const result = await nextLoad(url, context);
  if (filename) {
    if (result.source !== null && result.source !== undefined && hash(typeof result.source === 'string' ? Buffer.from(result.source) : Buffer.from(result.source)) !== configuration.files[filename].sha256) throw new Error('loaded module source hash mismatch');
    record({ type: 'load-returned', url, sha256: configuration.files[filename].sha256, format: result.format, evaluationProven: false });
  }
  return result;
}
