import fs from 'node:fs';
import path from 'node:path';
import childProcess from 'node:child_process';
import { createHash } from 'node:crypto';
import { registerHooks, syncBuiltinESMExports } from 'node:module';
import { fileURLToPath } from 'node:url';
const home = path.dirname(fileURLToPath(import.meta.url));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const manifest = JSON.parse(fs.readFileSync(path.join(home, 'PRESEAL.json')));
const allowed = new Map([...manifest.allowedModules, ...manifest.own].map(row => [row.path, row]));
const loaded = [];
for (const name of ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork']) childProcess[name] = () => { throw Error('REVIEW_CHILD_FORBIDDEN_' + name); };
syncBuiltinESMExports();
const hooks = registerHooks({ load(url, context, next) {
  if (!url.startsWith('file:')) return next(url, context);
  const filename = fileURLToPath(url); if (/\/(owner|launch|worker|coordinator|production)\.mjs$/.test(filename)) throw Error('ACTUAL_ENTRYPOINT_FORBIDDEN');
  const row = allowed.get(filename); if (!row) throw Error('UNBOUND_MODULE:' + filename);
  const info = fs.lstatSync(filename); if (!info.isFile() || info.isSymbolicLink() || info.size !== row.bytes || (info.mode & 511) !== row.mode || info.size > 262144) throw Error('MODULE_METADATA');
  if (hash(fs.readFileSync(filename)) !== row.sha256) throw Error('MODULE_HASH');
  loaded.push({ path: filename, bytes: row.bytes, sha256: row.sha256 }); fs.writeSync(3, JSON.stringify({ kind: 'authenticated-file-load-request', ...loaded.at(-1) }) + '\n');
  return next(url, context);
} });
let result;
try {
  process.argv[2] = manifest.rootSealSha256;
  const author = await import('./generated/controls.mjs');
  const novel = await import('./novel.mjs');
  const independent = await novel.run(author);
  result = { schema: 'FUNCTIONAL_V2_INDEPENDENT_RESULTS', author: author.report, independent, loaded, children: 0, actualEngines: 0, actualWorkers: 0, semanticPrograms: 0, actualAuthority: false };
  process.exitCode = author.report.failed || independent.some(row => !row.pass) ? 1 : 0;
} catch (error) { result = { schema: 'FUNCTIONAL_V2_INDEPENDENT_HOLD', error: { code: error?.code ?? null, message: String(error?.message).slice(0, 2048) }, loaded, children: 0 }; process.exitCode = 1; }
finally { hooks.deregister(); }
const bytes = Buffer.from(JSON.stringify(result, null, 2) + '\n'); if (bytes.length > 262144) throw Error('RESULT_CAP');
fs.writeFileSync(path.join(home, 'work/RESULT.json'), bytes, { flag: 'wx', mode: 0o600 });
process.stdout.write(JSON.stringify({ schema: result.schema, authorPassed: result.author?.passed, independentPassed: result.independent?.filter(row => row.pass).length, error: result.error ?? null, resultSha256: hash(bytes), children: 0 }) + '\n');
