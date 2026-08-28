import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { boundFile, hash, requireThat } from './core.mjs';

let configuration;
export function initialize(data) {
  configuration = data;
  configuration.port.on('message', message => {
    if (message.flush) configuration.port.postMessage({ kind: 'flushed' });
  });
  configuration.port.unref();
}
function member(url) {
  if (url.startsWith('node:')) return null;
  requireThat(url.startsWith('file:') && !url.includes('?') && !url.includes('#'), 'UNBOUND_MODULE', url);
  requireThat(!configuration.deniedUrls.includes(url), 'SOURCE_FALLBACK', url);
  const filename = fileURLToPath(url);
  requireThat(realpathSync(filename) === filename && configuration.files[filename], 'UNBOUND_MODULE', url);
  return filename;
}
export async function resolve(specifier, context, nextResolve) {
  const result = await nextResolve(specifier, context);
  member(result.url);
  configuration.port.postMessage({ kind: 'resolved', specifier, parentURL: context.parentURL ?? null, url: result.url });
  return result;
}
export async function load(url, context, nextLoad) {
  const filename = member(url);
  configuration.port.postMessage({ kind: 'load-attempt', url });
  if (filename) boundFile(filename, configuration.files[filename]);
  const result = await nextLoad(url, context);
  if (filename) {
    requireThat(result.format === 'module' && result.source != null, 'SOURCE_WITNESS_UNAVAILABLE', { url, format: result.format });
    const sourceHash = hash(Buffer.from(result.source));
    requireThat(sourceHash === configuration.files[filename].sha256, 'EXECUTED_SOURCE_HASH', url);
    configuration.port.postMessage({ kind: 'nextLoad', url, format: result.format, sha256: sourceHash, evaluationProven: false });
  }
  return result;
}
