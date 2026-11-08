import { lstatSync, readFileSync, writeFileSync, mkdirSync, openSync, readSync, closeSync, readdirSync, realpathSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { gunzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = path.dirname(fileURLToPath(import.meta.url));
const previous = path.resolve(root, '../preparation-v3');
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
function read(file, maximum) { const stat = lstatSync(file); if (!stat.isFile() || stat.isSymbolicLink() || stat.size > maximum || realpathSync(file) !== file) throw Error('regular input admission'); return readFileSync(file); }
function authenticate(record) { const stat = lstatSync(record.origin); if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== record.bytes || realpathSync(record.origin) !== record.origin) throw Error('tool metadata'); const fd = openSync(record.origin, 'r'); const scratch = Buffer.alloc(65536); const hash = createHash('sha256'); let count = 0; try { for (;;) { const size = readSync(fd, scratch, 0, scratch.length, null); if (!size) break; count += size; if (count > record.bytes) throw Error('tool grew'); hash.update(scratch.subarray(0, size)); } } finally { closeSync(fd); } if (count !== record.bytes || hash.digest('hex') !== record.sha256) throw Error('tool body'); }
const grant = JSON.parse(read(path.join(root, 'COMPILE-GRANT.json'), 8192));
const recipeBytes = read(path.join(root, 'EMISSION-RECIPE.json'), 65536);
if (grant.authorized !== true || grant.phase !== 'compile-only' || grant.recipeSha256 !== digest(recipeBytes)) throw Error('compiler grant');
const recipe = JSON.parse(recipeBytes);
const toolBytes = read(path.join(root, 'TOOLS.json'), 16384);
if (digest(toolBytes) !== recipe.toolSha256) throw Error('TOOLS recipe binding');
const tools = JSON.parse(toolBytes);
for (const record of [tools.node, ...tools.compiler.files]) authenticate(record);
if (process.execPath !== tools.node.origin || process.version !== tools.node.version) throw Error('Node identity');
const archiveBytes = read(path.join(previous, 'PUBLIC98.json.gz.base64'), 4000000);
if (digest(archiveBytes) !== recipe.archiveSha256) throw Error('source archive');
const archive = JSON.parse(gunzipSync(Buffer.from(archiveBytes.toString('utf8'), 'base64'), { maxOutputLength: 8388608 }));
if (archive.commit !== recipe.engineCommit || recipe.modules.length !== 95) throw Error('source recipe');
const ts = createRequire(import.meta.url)(tools.compiler.files[0].origin);
if (ts.version !== tools.compiler.version) throw Error('compiler version');
const outputRoot = path.join(root, 'run', 'compiled');
mkdirSync(outputRoot);
const records = []; const diagnostics = []; const graphs = []; let total = 0;
for (const entry of recipe.modules) {
  if (!(entry.output.startsWith('compiled/engine/dist/') || entry.output.startsWith('compiled/support/')) || !entry.output.endsWith('.js') || !/^[A-Za-z0-9_./-]+$/.test(entry.output) || entry.output.includes('..')) throw Error('output path');
  const source = entry.support ? read(path.join(previous, 'inputs/errors.ts.data'), 8192) : Buffer.from(archive.files.find(row => row.path === entry.source).base64, 'base64');
  if (source.length !== entry.sourceBytes || digest(source) !== entry.sourceSha256) throw Error('source binding');
  const emitted = ts.transpileModule(source.toString('utf8'), { fileName: entry.source, reportDiagnostics: true, compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, newLine: ts.NewLineKind.LineFeed, sourceMap: false, inlineSourceMap: false, inlineSources: false, declaration: false, removeComments: false, useDefineForClassFields: true } });
  for (const item of emitted.diagnostics ?? []) diagnostics.push({ source: entry.source, code: item.code, category: ts.DiagnosticCategory[item.category], start: item.start ?? null, length: item.length ?? null, message: ts.flattenDiagnosticMessageText(item.messageText, '\n') });
  const bytes = Buffer.from(emitted.outputText); total += bytes.length;
  if (bytes.length > 2097152 || total > 16777216 || diagnostics.length > 1024) throw Error('emission budget');
  const destination = path.join(root, 'run', entry.output);
  mkdirSync(path.dirname(destination), { recursive: true }); writeFileSync(destination, bytes, { flag: 'wx' });
  records.push({ path: entry.output, source: entry.source, sourceSha256: entry.sourceSha256, bytes: bytes.length, sha256: digest(bytes), sourceMapText: emitted.sourceMapText ?? null });
  const parsed = ts.createSourceFile(entry.output, emitted.outputText, ts.ScriptTarget.ES2022, true, ts.ScriptKind.JS); const imports = [];
  function visit(node) { if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) imports.push({ kind: 'static', specifier: node.moduleSpecifier.text }); if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) imports.push({ kind: 'dynamic', specifier: ts.isStringLiteral(node.arguments[0]) ? node.arguments[0].text : null }); ts.forEachChild(node, visit); }
  visit(parsed); graphs.push({ path: entry.output, imports });
}
const paths = new Set(records.map(row => row.path));
for (const row of graphs) for (const edge of row.imports) { edge.resolved = typeof edge.specifier === 'string' && edge.specifier.startsWith('.') ? path.posix.normalize(path.posix.join(path.posix.dirname(row.path), edge.specifier)) : edge.specifier; edge.inEmission = paths.has(edge.resolved); }
const census = []; function walk(directory) { for (const name of readdirSync(directory).sort()) { const location = path.join(directory, name); const stat = lstatSync(location); if (stat.isSymbolicLink()) throw Error('output link'); if (stat.isDirectory()) walk(location); else { const bytes = read(location, 2097152); census.push({ path: path.relative(path.join(root, 'run'), location).split(path.sep).join('/'), bytes: bytes.length, sha256: digest(bytes) }); } } } walk(outputRoot);
if (census.length !== records.length || census.some(row => !records.some(record => record.path === row.path && record.sha256 === row.sha256))) throw Error('output census');
const result = { phase: 'compiler-only', recipeSha256: digest(recipeBytes), toolSha256: digest(toolBytes), engineCommit: recipe.engineCommit, compilerVersion: ts.version, nodeVersion: process.version, actualInputs: records.length, emittedBytes: total, diagnostics, strictProgramTypecheck: false, sourceMapsEnabled: false, declarationEmission: false, engineModulesExecuted: 0, workers: 0, files: records, census, graph: graphs };
const receipt = Buffer.from(JSON.stringify(result, null, 2) + '\n'); if (receipt.length > 2097152) throw Error('receipt cap'); writeFileSync(path.join(root, 'run/EMITTED.json'), receipt, { flag: 'wx' });
console.log(JSON.stringify({ inputs: records.length, emittedBytes: total, diagnostics: diagnostics.length, errors: diagnostics.filter(row => row.category === 'Error').length }));
process.exitCode = diagnostics.some(row => row.category === 'Error') ? 1 : 0;
