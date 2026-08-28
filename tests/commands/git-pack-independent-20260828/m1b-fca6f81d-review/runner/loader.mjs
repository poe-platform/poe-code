import fs from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { enrolledUrl } from './load-policy.mjs';

const bindingFile = process.env.M1B_LOAD_BINDING;
const bindingStat = await fs.lstat(bindingFile);
if (!bindingStat.isFile() || bindingStat.isSymbolicLink() || (bindingStat.mode & 0o777) !== 0o600 || String(bindingStat.size) !== process.env.M1B_LOAD_BINDING_BYTES || await fs.realpath(bindingFile) !== bindingFile) throw new Error('LOAD_BINDING_PHYSICAL_IDENTITY');
const bindingBytes = await fs.readFile(bindingFile);
if (createHash('sha256').update(bindingBytes).digest('hex') !== process.env.M1B_LOAD_BINDING_SHA256) throw new Error('LOAD_BINDING_EXPECTED_HASH');
const binding = JSON.parse(bindingBytes.toString('utf8'));
const files = new Map(binding.files.map(row => [row.absolute, row]));
const builtins = new Set(binding.builtins);
function demand(condition, label) { if (!condition) throw new Error(label); }
export async function resolve(specifier, context, nextResolve) {
  const url = enrolledUrl(specifier, context.parentURL, files, builtins);
  if (url.startsWith('node:')) return nextResolve(specifier, context);
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
