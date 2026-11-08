import fs from 'node:fs';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

let configuration;
export function initialize(data) { configuration = data; }
const record = value => fs.appendFileSync(configuration.log, `${JSON.stringify({ pid: process.pid, at: new Date().toISOString(), ...value })}\n`);
function permitted(url) {
  if (url.startsWith('node:')) return null;
  if (!url.startsWith('file:')) throw new Error(`non-file module denied: ${url}`);
  const filename = fs.realpathSync(fileURLToPath(url));
  if (!filename.startsWith(`${configuration.root}/`)) throw new Error(`module outside copied closure: ${url}`);
  return filename;
}
export async function resolve(specifier, context, nextResolve) {
  const result = await nextResolve(specifier, context);
  permitted(result.url);
  record({ event: 'resolve-returned', specifier, parentURL: context.parentURL ?? null, url: result.url });
  return result;
}
export async function load(url, context, nextLoad) {
  const filename = permitted(url);
  if (filename) record({ event: 'load-attempt', url, filename, sha256: crypto.createHash('sha256').update(fs.readFileSync(filename)).digest('hex') });
  try {
    const result = await nextLoad(url, context);
    if (filename) record({ event: 'load-returned', url, format: result.format, interpretation: 'loader returned; module evaluation completion not implied' });
    return result;
  } catch (error) {
    record({ event: 'load-error', url, error: String(error) });
    throw error;
  }
}
