import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { differential, host } from './cases.mjs';
const own = path.dirname(fileURLToPath(import.meta.url));
const log = { role: 'DESIGN_DATA_CHECK_ONLY', started: new Date().toISOString(), product: 0, native: 0, childProcesses: 0 };
const outer = fs.openSync(path.join(own, 'CHECK.json'), 'wx');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
try {
  const expected = JSON.parse(fs.readFileSync(path.join(own, 'CASES.json')));
  assert.deepEqual(expected, { differential, host });
  assert.equal(differential.length, 40); assert.equal(host.length, 10);
  const preparation = JSON.parse(fs.readFileSync(path.join(own, 'PREPARATION.json')));
  const bytes = fs.readFileSync(path.join(own, 'SOURCE-DATA.json.gz'));
  assert.equal(sha(bytes), preparation.capsuleSha256);
  const capsule = JSON.parse(gunzipSync(bytes, { maxOutputLength: 8 * 1024 * 1024 }));
  assert.equal(capsule.entries.length, 61);
  for (const row of capsule.entries) { assert.ok(!row.path.split('/').some(part => part.toLowerCase() === 'agents.md')); const body = Buffer.from(row.base64, 'base64'); assert.equal(body.length, row.bytes); assert.equal(sha(body), row.sha256); }
  const binding = JSON.parse(fs.readFileSync(path.join(own, 'BINDING.json')));
  for (const row of binding.selected) assert.equal(capsule.entries.find(entry => entry.path === row.path + '.data').sha256, row.sha256);
  const tool = fs.realpathSync(process.execPath), stat = fs.statSync(tool); assert.ok(stat.isFile() && stat.size < 256 * 1024 * 1024);
  const hash = createHash('sha256'); for await (const chunk of fs.createReadStream(tool)) hash.update(chunk);
  log.helperRuntime = { invokedPath: process.execPath, realPath: tool, bytes: stat.size, sha256: hash.digest('hex'), version: process.version, role: 'Source/data helper only, not product/runtime qualification' };
  log.cases = 40; log.hostProtocols = 10; log.sourceBlobs = 38; log.capsuleRecords = 61; log.allProductOutcomes = 'UNRUN';
  log.finished = new Date().toISOString(); log.designOnlyChecksPassed = true;
} catch (error) { log.error = { message: String(error), stack: error?.stack }; process.exitCode = 1; }
finally { fs.writeSync(outer, JSON.stringify(log, null, 2)); fs.closeSync(outer); }
console.log(JSON.stringify(log));
