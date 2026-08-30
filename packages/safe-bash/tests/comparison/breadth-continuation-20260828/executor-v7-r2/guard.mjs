import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { registerHooks, isBuiltin } from 'node:module';
const root = path.dirname(fileURLToPath(import.meta.url));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const seal = JSON.parse(fs.readFileSync(path.join(root, 'SEAL.json')));
const allowed = new Map(seal.files.filter(entry => entry.path.endsWith('.mjs') && !entry.path.includes('node_modules/')).map(entry => [pathToFileURL(path.resolve(root, entry.path)).href, entry]));
const loaded = [], denied = [];
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (isBuiltin(specifier)) return nextResolve(specifier, context);
    const result = nextResolve(specifier, context);
    if (!allowed.has(result.url)) { denied.push({ code: 'TEST_UNBOUND_MODULE', url: result.url }); throw new Error('TEST_UNBOUND_MODULE'); }
    return result;
  },
  load(url, context, nextLoad) {
    if (isBuiltin(url)) return nextLoad(url, context);
    const expected = allowed.get(url), filename = fileURLToPath(url), info = fs.lstatSync(filename);
    if (!expected || !info.isFile() || info.isSymbolicLink() || info.size !== expected.bytes || (info.mode & 0o7777) !== expected.mode) throw new Error('TEST_LOAD_METADATA');
    const result = nextLoad(url, context), bytes = Buffer.from(result.source);
    if (result.format !== 'module' || hash(bytes) !== expected.sha256) throw new Error('TEST_LOAD_HASH');
    loaded.push({ path: expected.path, bytes: bytes.length, sha256: hash(bytes), actualNextLoad: true }); return result;
  },
});
process.on('exit', () => {
  try {
    const directory = process.cwd();
    if (!directory.startsWith(`${root}/runs/`)) throw new Error('TEST_WITNESS_SCOPE');
    const bytes = Buffer.from(`${JSON.stringify({ pid: process.pid, main: process.argv[1], loaded, denied, noEngineAllowlist: true })}\n`);
    if (bytes.length > 262144) throw new Error('TEST_WITNESS_CAP');
    fs.writeFileSync(path.join(directory, `loads-${process.pid}.json`), bytes, { flag: 'wx', mode: 0o644 });
  } catch { process.exitCode = 1; }
});
