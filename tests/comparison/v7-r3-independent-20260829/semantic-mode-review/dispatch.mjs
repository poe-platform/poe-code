import fs from 'node:fs';
import path from 'node:path';
import childProcess from 'node:child_process';
import { createHash } from 'node:crypto';
import { registerHooks, syncBuiltinESMExports } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
const home = path.dirname(fileURLToPath(import.meta.url));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const log = value => fs.writeSync(3, JSON.stringify(value) + '\n');
const manifest = JSON.parse(fs.readFileSync(path.join(home, 'PRESEAL.json')));
const allowed = new Map([...manifest.allowedModules, ...manifest.own].map(row => [row.path, row]));
const loaded = [];
const children = [];
const originalSpawn = childProcess.spawn;
childProcess.spawn = function(file, args, options) {
  if (file !== '/Users/kjopek/.nvm/versions/node/v22.22.2/bin/node' || JSON.stringify(args) !== JSON.stringify(['--unhandled-rejections=strict', path.join(home, 'byte-stub.mjs')]) || options.cwd !== home || children.length !== 0) throw Error('INDEPENDENT_CHILD_DENIED');
  const row = { role: 'sole-owned-byte-stub', pid: null, exit: null, close: null }; children.push(row);
  const child = originalSpawn(file, args, options); row.pid = child.pid; log({ kind: 'child-enrolled', ...row });
  child.once('exit', (code, signal) => { row.exit = { code, signal }; log({ kind: 'child-exit', ...row }); });
  child.once('close', (code, signal) => { row.close = { code, signal }; log({ kind: 'child-close', ...row }); });
  return child;
};
for (const name of ['spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork']) childProcess[name] = () => { throw Error('INDEPENDENT_PROCESS_DENIED_' + name); };
syncBuiltinESMExports();
const hooks = registerHooks({ load(url, context, next) {
  if (!url.startsWith('file:')) return next(url, context);
  const filename = fileURLToPath(url);
  if (/\/(owner|launch|worker|coordinator|production)\.mjs$/.test(filename)) throw Error('REAL_ENTRYPOINT_DENIED');
  const expected = allowed.get(filename); if (!expected) throw Error('UNBOUND_REVIEW_MODULE:' + filename);
  const info = fs.lstatSync(filename); if (!info.isFile() || info.isSymbolicLink() || info.size !== expected.bytes || (info.mode & 511) !== expected.mode || info.size > 262144) throw Error('MODULE_METADATA');
  const bytes = fs.readFileSync(filename); if (hash(bytes) !== expected.sha256) throw Error('MODULE_HASH');
  loaded.push({ path: filename, bytes: bytes.length, sha256: expected.sha256 }); log({ kind: 'actual-source-load', ...loaded.at(-1) });
  return next(url, context);
} });
let output;
try {
  process.argv[2] = manifest.rootSealSha256;
  const author = await import('./generated/controls.mjs');
  const novel = await import('./novel.mjs');
  const rows = await novel.run(author);
  if (children.some(row => !row.close)) throw Error('UNKNOWN_CHILD_RETIREMENT');
  output = { schema: 'INDEPENDENT_SEMANTIC_PREEXECUTION_RESULTS_V1', author: author.report, independent: rows, loaded, children, realEngines: 0, realWorkers: 0, actualAuthority: false, semanticPrograms: 0 };
  process.exitCode = author.report.failed || author.report.unrun || rows.some(row => !row.pass) ? 1 : 0;
} catch (error) { output = { schema: 'INDEPENDENT_SEMANTIC_PREEXECUTION_HOLD_V1', error: { code: error?.code ?? null, message: String(error?.message).slice(0, 2000) }, loaded, children }; process.exitCode = 1; }
finally { hooks.deregister(); }
const bytes = Buffer.from(JSON.stringify(output, null, 2) + '\n'); if (bytes.length > 262144) throw Error('REPORT_BOUND');
fs.writeFileSync(path.join(home, 'work/RESULT.json'), bytes, { flag: 'wx', mode: 0o600 });
process.stdout.write(JSON.stringify({ schema: output.schema, authorPassed: output.author?.passed, novelPassed: output.independent?.filter(row => row.pass).length, error: output.error ?? null, children: children.length, resultSha256: hash(bytes) }) + '\n');
