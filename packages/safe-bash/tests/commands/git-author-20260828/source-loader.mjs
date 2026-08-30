import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const binding = JSON.parse(await fs.readFile(process.env.GIT_AUTHOR_BINDING));
const compiler = createRequire(import.meta.url)(binding.compiler);
const rows = new Map(binding.inputs.map(row => [path.join(binding.root, 'src', row.path), row]));
export async function resolve(specifier, context, next) {
  if (specifier.endsWith('.js') && (specifier.startsWith('.') || specifier.startsWith('file:'))) {
    const url = new URL(specifier, context.parentURL);
    if (url.protocol === 'file:' && fileURLToPath(url).startsWith(binding.root + '/src/')) {
      const source = fileURLToPath(url).slice(0, -3) + '.ts';
      if (!rows.has(source)) throw new Error('source loader missing authenticated source');
      return { url: pathToFileURL(source).href, shortCircuit: true };
    }
  }
  return next(specifier, context);
}
export async function load(url, context, next) {
  if (url.startsWith('file:') && url.endsWith('.ts')) {
    const file = fileURLToPath(url), row = rows.get(file);
    if (!row) throw new Error('source loader outside binding');
    const bytes = await fs.readFile(file);
    if (createHash('sha256').update(bytes).digest('hex') !== row.sha256) throw new Error('source loader hash mismatch');
    await fs.appendFile(path.join(binding.output, 'source-loads.jsonl'), JSON.stringify({ file, sha256: row.sha256 }) + '\n');
    return { format: 'module', source: compiler.transpileModule(bytes.toString(), { compilerOptions: { target: compiler.ScriptTarget.ES2022, module: compiler.ModuleKind.ES2022 } }).outputText, shortCircuit: true };
  }
  return next(url, context);
}
