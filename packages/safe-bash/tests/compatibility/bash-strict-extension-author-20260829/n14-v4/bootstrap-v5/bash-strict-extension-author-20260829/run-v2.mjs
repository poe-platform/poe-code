import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
const here = path.dirname(fileURLToPath(import.meta.url));
const own = path.resolve(here, '../..');
const output = path.join(own, 'bootstrap-output-v5');
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
  const entry = path.join(own, 'prepare-entry-v5.mjs');
  assert.equal(createHash('sha256').update(fs.readFileSync(entry)).digest('hex'), seal.preparationEntrySha256);
  note({ inheritedControls: 3, evidence: '0db27688d279423f6eb7a4f8eb5c430f50876b49', rerun: false });
  child(['--check', entry], 0);
  const prepared = child([entry, '--prepare'], 0); process.stdout.write(prepared.text); process.stderr.write(prepared.error);
  note({ finished: new Date().toISOString(), inheritedControls: 3, freshSyntaxAdmission: 1, productExecutions: 0 });
} catch (error) { note({ error: String(error), stack: error?.stack }); console.error(error); process.exitCode = 1; }
finally { fs.closeSync(log); }
