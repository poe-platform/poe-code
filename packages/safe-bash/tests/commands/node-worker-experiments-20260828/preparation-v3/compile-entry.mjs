import { lstatSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { gunzipSync } from 'node:zlib';
const root = new URL('.', import.meta.url);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
function read(name, maximum) { const path = new URL(name, root); const stat = lstatSync(path); if (!stat.isFile() || stat.isSymbolicLink() || stat.size > maximum) throw new Error('compile read admission'); return readFileSync(path); }
const grant = JSON.parse(read('COMPILE-GRANT.json', 8192));
const recipeBytes = read('EMISSION-RECIPE.json', 65536);
if (grant.authorized !== true || grant.phase !== 'compile-only' || grant.recipeSha256 !== hash(recipeBytes)) throw new Error('separate exact compiler GO required');
const recipe = JSON.parse(recipeBytes);
const tools = JSON.parse(read('TOOLS.json', 16384));
const archiveBytes = read('PUBLIC98.json.gz.base64', 4000000);
if (hash(archiveBytes) !== recipe.archiveSha256) throw new Error('compile source archive');
const archive = JSON.parse(gunzipSync(Buffer.from(archiveBytes.toString(), 'base64'), { maxOutputLength: 8388608 }));
const tool = tools.compiler.files[0];
const toolStat = lstatSync(tool.origin);
if (!toolStat.isFile() || toolStat.isSymbolicLink() || toolStat.size !== tool.bytes || hash(readFileSync(tool.origin)) !== tool.sha256) throw new Error('compiler exact tool');
const ts = createRequire(import.meta.url)(tool.origin);
const output = new URL('./compiled/', root);
mkdirSync(output, { recursive: false });
const records = [];
for (const entry of recipe.modules) {
  const source = entry.support ? read('inputs/errors.ts.data', 8192) : Buffer.from(archive.files.find(row => row.path === entry.source).base64, 'base64');
  if (hash(source) !== entry.sourceSha256 || source.length !== entry.sourceBytes) throw new Error('compile body');
  const emitted = ts.transpileModule(source.toString('utf8'), { fileName: entry.source, compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, newLine: ts.NewLineKind.LineFeed, sourceMap: false, declaration: false, removeComments: false, useDefineForClassFields: true } });
  if ((emitted.diagnostics ?? []).some(row => row.category === ts.DiagnosticCategory.Error)) throw new Error('transpile diagnostic');
  const bytes = Buffer.from(emitted.outputText);
  if (bytes.length > 2097152) throw new Error('emission cap');
  const destination = new URL(entry.output, root);
  mkdirSync(new URL('.', destination), { recursive: true });
  writeFileSync(destination, bytes, { flag: 'wx' });
  records.push({ path: entry.output, bytes: bytes.length, sha256: hash(bytes) });
}
writeFileSync(new URL('EMITTED.json', output), JSON.stringify({ recipeSha256: hash(recipeBytes), files: records, qualified: false, requiresDifferentReviewBeforeWorkerGo: true }) + '\n', { flag: 'wx' });
