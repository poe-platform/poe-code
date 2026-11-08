import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createGunzip } from 'node:zlib';
import { createInterface } from 'node:readline';

export const root = 'tests/commands/xan-module-review-20260828/';
export const owned = `${root}diagnosis-v1/`;
export const resultCommit = 'dad2b08ce6bba02d3c404e7a55da5f4163b39d77';
export const candidate = '0ec84fc38c3fafd75776d80148d4f3c2d77e6247';
export const base = '5137a74ec855a32d8a8860eb66b62eb44d11e290';
export const freeze = '55810d4aea70fadf151c2fbf746a17f96bfeb599';
export const independent = 'tests/commands/xan-independent-20260828/';
export const hash = data => createHash('sha256').update(data).digest('hex');
export const read = (path, revision = resultCommit) => execFileSync('git', ['show', `${revision}:${path}`], { maxBuffer: 32 * 1024 * 1024 });
export const json = (path, revision) => JSON.parse(read(path, revision));
export const binding = (path, revision = resultCommit) => {
  const bytes = read(path, revision);
  return { revision, path, bytes: bytes.length, sha256: hash(bytes) };
};

export async function archive() {
  const path = `${root}actual-review-v2/CONTINUATION-EVIDENCE.jsonl.gz`;
  const seal = json(`${root}actual-review-v2/CONTINUATION-EVIDENCE-SEAL.json`);
  const child = spawn('git', ['show', `${resultCommit}:${path}`], { stdio: ['ignore', 'pipe', 'pipe'] });
  const done = new Promise((resolve, reject) => { child.once('error', reject); child.once('close', code => code === 0 ? resolve() : reject(Error(`git archive read: ${code}`))); });
  const digest = createHash('sha256');
  let compressed = 0;
  child.stdout.on('data', chunk => { digest.update(chunk); compressed += chunk.length; });
  const expected = seal.entries.filter(entry => !entry.directory);
  const cases = new Map();
  const retained = new Map();
  let count = 0;
  let total = 0;
  for await (const line of createInterface({ input: child.stdout.pipe(createGunzip()), crlfDelay: Infinity })) {
    assert.ok(line.length <= 96 * 1024 * 1024);
    const record = JSON.parse(line);
    const entry = expected[count++];
    const bytes = Buffer.from(record.base64, 'base64');
    assert.equal(record.path, entry.path);
    assert.equal(bytes.length, entry.bytes);
    assert.equal(hash(bytes), entry.sha256);
    total += bytes.length;
    assert.ok(total <= 256 * 1024 * 1024);
    if (/^(SOURCE|INSTALLED_MOVED)-\d+\/(stdout.raw|START.json)$/.test(record.path)) {
      retained.set(record.path, bytes);
      if (!record.path.endsWith('/stdout.raw')) continue;
      for (const [index, text] of bytes.toString().split('\n').entries()) {
        if (!text) continue;
        const value = JSON.parse(text);
        if (!value.id) continue;
        const layout = record.path.split('/')[0].replace(/-\d+$/, '');
        const key = `${layout}/${value.id}`;
        const rows = cases.get(key) ?? [];
        rows.push({ path: record.path, line: index + 1, lineSha256: hash(Buffer.from(text)), record: value });
        cases.set(key, rows);
      }
    }
  }
  await done;
  const sha256 = digest.digest('hex');
  assert.equal(sha256, seal.archive.sha256);
  assert.equal(compressed, seal.archive.bytes);
  assert.equal(count, expected.length);
  assert.equal(total, seal.totalPayloadBytes);
  assert.equal(cases.size, 1334);
  return { cases, retained, entries: expected, evidence: { revision: resultCommit, path, sha256, compressed, files: count, payloadBytes: total, extraction: false } };
}
