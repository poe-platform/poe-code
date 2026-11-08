import { registerHooks } from 'node:module';
import { readFileSync, appendFileSync, realpathSync, existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
const root = realpathSync(process.env.SURFACE_ROOT), binding = JSON.parse(readFileSync(join(root, 'BINDING.json')));
const ts = (await import(pathToFileURL(join(root, 'node_modules/typescript/lib/typescript.js')))).default;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
registerHooks({
  resolve(specifier, context, next) {
    if (specifier.startsWith('file:')) {
      const path = fileURLToPath(specifier);
      if (!path.startsWith(root + '/')) throw new Error('Outside import: ' + path);
      if (path.startsWith(root + '/product/')) throw new Error('No archive-source fallback: ' + path);
    }
    try { return next(specifier, context); }
    catch (error) {
      if (context.parentURL?.startsWith(pathToFileURL(root + '/engine/').href) && specifier.startsWith('.') && specifier.endsWith('.js')) {
        const url = new URL(specifier.slice(0, -3) + '.ts', context.parentURL);
        if (existsSync(url)) return { url: url.href, shortCircuit: true };
      }
      throw error;
    }
  },
  load(url, context, next) {
    if (!url.startsWith('file:')) return next(url, context);
    const path = realpathSync(fileURLToPath(url)); if (!path.startsWith(root + '/')) throw new Error('Outside import: ' + path);
    const relative = path.slice(root.length + 1), expected = binding.files[relative];
    if (!expected) throw new Error('Unknown current import: ' + relative);
    const bytes = readFileSync(path); if (hash(bytes) !== expected) throw new Error('Changed current import: ' + relative);
    if (relative.startsWith('engine/') && !binding.engineClosure.includes(relative)) throw new Error('Unapproved actual-engine import: ' + relative);
    appendFileSync(process.env.SURFACE_IMPORTS, JSON.stringify({ path: relative, sha256: hash(bytes) }) + '\n');
    if (path.endsWith('.ts')) return { format: 'module', source: ts.transpileModule(bytes.toString(), { compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ESNext, verbatimModuleSyntax: true } }).outputText, shortCircuit: true };
    return next(url, context);
  },
});
