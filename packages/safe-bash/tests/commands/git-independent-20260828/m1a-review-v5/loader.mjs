import * as fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';

let binding, rows, compiler, traceBytes = 0;
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
export async function initialize(data) {
  binding = data;
  rows = new Map(binding.files.map(row => [row.path, row]));
  if (!rows.has(binding.entry)) throw new Error('BINDING_ENTRY_REFUSED');
  for (const row of binding.files) {
    const stat = await fs.lstat(row.path);
    if (!stat.isFile() || stat.isSymbolicLink() || await fs.realpath(row.path) !== row.path) throw new Error('BINDING_NONREGULAR_REFUSED');
    const bytes = await fs.readFile(row.path);
    if (sha(bytes) !== row.sha256) throw new Error('BINDING_HASH_REFUSED');
  }
  if (binding.source) compiler = createRequire(import.meta.url)(binding.compiler);
}
export async function resolve(specifier, context, next) {
  if (specifier.startsWith('node:')) return next(specifier, context);
  if (binding.source && (specifier.startsWith('.') || specifier.startsWith('file:'))) {
    const url = new URL(specifier, context.parentURL);
    if (url.protocol === 'file:' && fileURLToPath(url).startsWith(binding.root + '/src/') && url.pathname.endsWith('.js')) {
      const target = fileURLToPath(url).slice(0, -3) + '.ts';
      if (!rows.has(target)) throw new Error('BINDING_SOURCE_IMPORT_REFUSED');
      return { url: pathToFileURL(target).href, shortCircuit: true };
    }
  }
  if (specifier.startsWith('file:') || specifier.startsWith('.')) {
    const target = new URL(specifier, context.parentURL);
    if (target.protocol === 'file:' && !rows.has(fileURLToPath(target))) throw new Error('BINDING_IMPORT_REFUSED');
  }
  const result = await next(specifier, context);
  if (result.url.startsWith('file:') && !rows.has(fileURLToPath(result.url))) throw new Error('BINDING_IMPORT_REFUSED');
  return result;
}
export async function load(url, context, next) {
  if (url.startsWith('node:')) return next(url, context);
  if (!url.startsWith('file:')) throw new Error('BINDING_PROTOCOL_REFUSED');
  const file = fileURLToPath(url), row = rows.get(file);
  if (!row) throw new Error('BINDING_MEMBER_REFUSED');
  const bytes = await fs.readFile(file);
  if (sha(bytes) !== row.sha256) throw new Error('BINDING_HASH_REFUSED');
  const record = JSON.stringify({ file, sha256: row.sha256, source: file.endsWith('.ts') }) + '\n';
  traceBytes += Buffer.byteLength(record); if (traceBytes > 524288) throw new Error('BINDING_TRACE_LIMIT');
  await fs.appendFile(binding.trace, record);
  if (file.endsWith('.ts')) return { format: 'module', source: compiler.transpileModule(bytes.toString(), { compilerOptions: { target: compiler.ScriptTarget.ES2023, module: compiler.ModuleKind.ES2022 } }).outputText, shortCircuit: true };
  return next(url, context);
}
