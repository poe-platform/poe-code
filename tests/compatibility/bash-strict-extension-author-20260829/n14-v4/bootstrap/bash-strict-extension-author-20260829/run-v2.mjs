import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
const here = path.dirname(fileURLToPath(import.meta.url));
const own = path.resolve(here, '../..');
const output = path.join(own, 'bootstrap-output');
fs.mkdirSync(output);
const log = fs.openSync(path.join(output, 'events.jsonl'), 'wx');
let sequence = 0;
function note(value) { fs.writeSync(log, JSON.stringify(value) + '\n'); }
function child(args, expected) {
  const prefix = path.join(output, String(sequence++));
  const stdout = fs.openSync(prefix + '.stdout', 'wx'), stderr = fs.openSync(prefix + '.stderr', 'wx');
  let result;
  try { result = spawnSync(process.execPath, args, { stdio: ['ignore', stdout, stderr], timeout: 30000 }); }
  finally { fs.closeSync(stdout); fs.closeSync(stderr); }
  note({ args, pid: result.pid, status: result.status, signal: result.signal, prefix });
  assert.equal(result.error, undefined); assert.equal(result.signal, null); assert.equal(result.status, expected);
  const text = fs.readFileSync(prefix + '.stdout'), error = fs.readFileSync(prefix + '.stderr');
  assert.ok(text.length + error.length <= 1048576);
  return { text, error };
}
try {
  note({ role: 'DATA_BOOTSTRAP_ONLY', pid: process.pid, started: new Date().toISOString(), productExecutions: 0 });
  assert.deepEqual(process.argv.slice(2), ['--run']);
  const seal = JSON.parse(fs.readFileSync(path.join(here, 'PRESEAL-v2.json')));
  assert.equal(process.execPath, seal.node.path); assert.equal(process.version, seal.node.version);
  const hash = createHash('sha256'); for await (const bytes of fs.createReadStream(process.execPath)) hash.update(bytes);
  assert.equal(hash.digest('hex'), seal.node.sha256);
  const entry = path.join(own, 'prepare-entry.mjs');
  assert.equal(createHash('sha256').update(fs.readFileSync(entry)).digest('hex'), seal.preparationEntrySha256);
  const bad = path.join(output, 'syntax-negative.mjs'); fs.writeFileSync(bad, 'const = ;\n', { flag: 'wx' });
  const syntax = child(['--check', bad], 1); assert.match(syntax.error.toString(), /SyntaxError/);
  const missing = child(['--check', path.join(output, 'missing', 'entry.mjs')], 1); assert.ok(missing.error.length > 0);
  const probe = path.join(output, 'capture-probe.mjs');
  fs.writeFileSync(probe, 'process.stdout.write("owned-out\\n");process.stderr.write("owned-err\\n");\n', { flag: 'wx' });
  const captured = child([probe], 0); assert.equal(captured.text.toString(), 'owned-out\n'); assert.equal(captured.error.toString(), 'owned-err\n');
  child(['--check', entry], 0);
  const prepared = child([entry, '--prepare'], 0); process.stdout.write(prepared.text); process.stderr.write(prepared.error);
  note({ finished: new Date().toISOString(), controls: 3, syntaxAdmission: 1, productExecutions: 0 });
} catch (error) { note({ error: String(error), stack: error?.stack }); console.error(error); process.exitCode = 1; }
finally { fs.closeSync(log); }
