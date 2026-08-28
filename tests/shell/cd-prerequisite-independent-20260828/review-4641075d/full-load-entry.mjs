import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, writeFileSync } from 'node:fs';
import { isBuiltin, registerHooks } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const configBytes = readFileSync(process.argv[2]);
assert.equal(process.env.CD_REVIEW_CONFIG_SHA256, hash(configBytes), 'admission: explicit parent config digest');
const config = JSON.parse(configBytes);
assert.equal(config.authorization, 'ROOT_EXECUTION_AUTHORIZED');
assert.equal(config.binding.state, 'routed-candidate');
assert(/^[a-f0-9]{40}$/u.test(config.binding.candidateCommit));
assert.equal(config.route.authorization, config.authorization);
assert.equal(config.route.candidateCommit, config.binding.candidateCommit);
assert.equal(config.route.bindingSha256, hash(JSON.stringify(config.binding)));
assert(config.route.reference);
assert(['source', 'installed', 'moved'].includes(config.mode));
const loaded = [];
const check = path => {
  assert(config.allowed[path], `LOAD_OUTSIDE:${path}`);
  assert(existsSync(path), `LOAD_MISSING:${path}`);
  assert(lstatSync(path).isFile() && !lstatSync(path).isSymbolicLink(), `LOAD_REGULAR:${path}`);
  const bytes = readFileSync(path);
  assert.equal(hash(bytes), config.allowed[path], `LOAD_HASH:${path}`);
  return bytes;
};
let compiler;
if (config.mode === 'source') {
  check(config.compiler);
  compiler = (await import(pathToFileURL(config.compiler).href)).default;
}
const packageJson = JSON.parse(check(resolve(config.packageRoot, 'package.json')));
const rootExport = packageJson.exports['.'];
const importExport = typeof rootExport === 'string' ? rootExport : rootExport.import;
assert.equal(typeof importExport, 'string');
const publicEntry = resolve(config.packageRoot, config.mode === 'source' ? importExport.replace(/^\.\/dist\//u, 'src/').replace(/\.js$/u, '.ts') : importExport);
const sourceFile = path => config.mode === 'source' && path.startsWith(`${config.packageRoot}/src/`) && path.endsWith('.js') ? path.slice(0, -3) + '.ts' : path;
globalThis.fetch = async () => { throw new Error('NETWORK_FORBIDDEN: injected WebDAV mock only'); };
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (isBuiltin(specifier)) return nextResolve(specifier, context);
    let path;
    if (specifier === 'virtual-bash') {
      path = publicEntry;
      if (config.mode !== 'source') assert.equal(fileURLToPath(nextResolve(specifier, context).url), path, 'actual installed bare resolution');
    } else if (specifier.startsWith('file:')) path = sourceFile(fileURLToPath(specifier));
    else if (specifier.startsWith('.') && context.parentURL?.startsWith('file:')) path = sourceFile(resolve(dirname(fileURLToPath(context.parentURL)), specifier));
    else throw new Error(`LOAD_BARE_FORBIDDEN:${specifier}`);
    check(path);
    return { url: pathToFileURL(path).href, shortCircuit: true };
  },
  load(url, context, nextLoad) {
    if (!url.startsWith('file:')) return nextLoad(url, context);
    const path = fileURLToPath(url);
    const bytes = check(path);
    let source = bytes.toString();
    if (path.endsWith('.ts')) {
      assert.equal(config.mode, 'source');
      source = compiler.transpileModule(source, { fileName: path, compilerOptions: { target: compiler.ScriptTarget.ES2023, module: compiler.ModuleKind.ESNext, verbatimModuleSyntax: true } }).outputText;
    }
    loaded.push({ path, sha256: hash(bytes), transformedSha256: hash(source) });
    return { format: 'module', source, shortCircuit: true };
  },
});
if (config.negative) {
  let failure;
  try {
    if (config.negative.kind === 'outside') await import(pathToFileURL(config.negative.path).href);
    else await import('virtual-bash');
  } catch (error) { failure = String(error); }
  assert(failure?.includes(config.negative.path), `wrong negative failure path: ${failure}`);
  assert(config.negative.kind === 'missing' ? failure.includes('LOAD_MISSING') || failure.includes('ERR_MODULE_NOT_FOUND') : failure.includes(config.negative.expected), `wrong import admission failure: ${failure}`);
  writeFileSync(config.resultPath, JSON.stringify({ classification: 'actual-public-root-import-admission-negative', negative: config.negative, failure, loaded }), { flag: 'wx' });
} else {
  const api = await import('virtual-bash');
  const data = await import('./cases-v1.mjs');
  const { scenario } = await import('./mapping.mjs');
  const { executeCase } = await import('./fixtures.mjs');
  const { series } = await import('./series.mjs');
  assert.equal(data.cases.length, 82);
  assert.equal(data.diagnosticCases.length, 4);
  const result = await series([...data.cases, ...data.diagnosticCases], async row => {
    try { return await executeCase(api, scenario(row, data.defaults), config); }
    catch (error) { return { id: row.id, status: 'cleanup-failure', cleanup: 'unknown', error: String(error), phase: 'setup-or-uncaught-executor-failure' }; }
  });
  writeFileSync(config.resultPath, JSON.stringify({ classification: 'future-public-runtime-evidence', mode: config.mode, candidate: config.binding, ...result, loaded }), { flag: 'wx' });
  process.exitCode = result.stopped || result.results.some(row => row.status === 'assertion-failure') ? 1 : 0;
}
