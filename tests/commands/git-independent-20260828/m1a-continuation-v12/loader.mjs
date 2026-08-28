import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { readFileSync, appendFileSync, lstatSync, realpathSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

let binding, members, compiler, bytesWritten = 0;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const log = value => {
  const line = JSON.stringify(value) + '\n'; bytesWritten += Buffer.byteLength(line);
  assert.ok(bytesWritten <= 524288, 'loaded trace cap'); appendFileSync(binding.trace, line);
};
export function initialize(data) {
  binding = data; members = new Map(data.files.map(row => [row.path, row]));
  if (!members.has(data.productEntry)) throw new Error('BINDING_ENTRY_REFUSED');
  for (const row of data.files) {
    if (!lstatSync(row.path).isFile() || lstatSync(row.path).isSymbolicLink() || realpathSync(row.path) !== row.path || hash(readFileSync(row.path)) !== row.sha256) throw new Error('BINDING_HASH_REFUSED');
  }
  if (data.source) {
    assert.equal(hash(readFileSync(data.compiler)), data.compilerSha256);
    compiler = createRequire(import.meta.url)(data.compiler); assert.equal(compiler.version, '5.9.3');
  }
  log({ kind: 'loader', url: import.meta.url, sha256: hash(readFileSync(fileURLToPath(import.meta.url))), source: data.source });
}
export async function resolve(specifier, context, next) {
  if (specifier.startsWith('node:')) {
    assert.ok(binding.allowedBuiltins.includes(specifier), 'unbound builtin ' + specifier); return next(specifier, context);
  }
  if (!specifier.startsWith('.') && !specifier.startsWith('file:')) throw new Error('BINDING_IMPORT_REFUSED');
  let target = new URL(specifier, context.parentURL);
  if (target.protocol !== 'file:' || target.search || target.hash) throw new Error('BINDING_IMPORT_REFUSED');
  let file = fileURLToPath(target);
  if (binding.source && file.startsWith(binding.root + '/src/') && file.endsWith('.js')) {
    file = file.slice(0, -3) + '.ts'; target = pathToFileURL(file);
  }
  if (!members.has(file)) throw new Error('BINDING_IMPORT_REFUSED');
  return { url: target.href, shortCircuit: true };
}
export async function load(url, context, next) {
  if (url.startsWith('node:')) { assert.ok(binding.allowedBuiltins.includes(url)); return next(url, context); }
  const file = fileURLToPath(url), member = members.get(file);
  if (!member) throw new Error('BINDING_IMPORT_REFUSED');
  const input = readFileSync(file); if (hash(input) !== member.sha256) throw new Error('BINDING_HASH_REFUSED');
  let output = input;
  if (file.endsWith('.ts')) output = Buffer.from(compiler.transpileModule(input.toString(), { compilerOptions: { target: compiler.ScriptTarget.ES2023, module: compiler.ModuleKind.ES2022 } }).outputText);
  log({ kind: 'module', url, sourceSha256: hash(input), loadedSha256: hash(output), sourceBytes: input.length, loadedBytes: output.length, role: member.role });
  return { format: 'module', source: output, shortCircuit: true };
}
