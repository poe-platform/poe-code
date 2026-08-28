import fs from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';

const binding = JSON.parse(await fs.readFile(process.env.M1B_LOAD_BINDING, 'utf8'));
const files = new Map(binding.files.map(row => [row.absolute, row]));
const builtins = new Set(binding.builtins);
function demand(condition, label) { if (!condition) throw new Error(label); }
export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('node:')) {
    demand(builtins.has(specifier), `BUILTIN_DENIED:${specifier}`);
    return nextResolve(specifier, context);
  }
  demand(specifier.startsWith('file:') || specifier.startsWith('./') || specifier.startsWith('../') || specifier.startsWith('/'), `AMBIENT_IMPORT_DENIED:${specifier}`);
  const url = specifier.startsWith('/') ? pathToFileURL(specifier).href : new URL(specifier, context.parentURL).href;
  demand(!new URL(url).search && !new URL(url).hash && files.has(fileURLToPath(url)), 'LOAD_NOT_ENROLLED');
  return { url, shortCircuit: true };
}
export async function load(url, context, nextLoad) {
  if (url.startsWith('node:')) return nextLoad(url, context);
  const filename = fileURLToPath(url);
  const row = files.get(filename);
  demand(row && await fs.realpath(filename) === filename, 'LOAD_REALPATH');
  const stat = await fs.lstat(filename);
  demand(stat.isFile() && !stat.isSymbolicLink() && (stat.mode & 0o777) === row.mode && stat.size === row.bytes, 'LOAD_KIND_MODE_SIZE');
  const source = await fs.readFile(filename);
  demand(createHash('sha256').update(source).digest('hex') === row.sha256, 'LOAD_HASH');
  process.stderr.write(JSON.stringify({ role: 'M1B_ACTUAL_MODULE_LOAD', path: filename, sha256: row.sha256 }) + '\n');
  return { format: 'module', source, shortCircuit: true };
}
