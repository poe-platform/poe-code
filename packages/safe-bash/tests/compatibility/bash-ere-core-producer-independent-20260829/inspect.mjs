import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
const root = process.cwd();
const owned = 'tests/compatibility/bash-ere-core-producer-independent-20260829';
const packet = 'tests/compatibility/bash-ere-core-transport-rebind-20260829/author-v3';
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const read = (name, cap = 4 * 1024 * 1024) => {
  const stat = fs.lstatSync(name);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > cap) throw new Error(`admission ${name}`);
  const bytes = fs.readFileSync(name);
  if (bytes.length !== stat.size) throw new Error(`size race ${name}`);
  return bytes;
};
const records = [];
for (const tree of ['final-tree.raw', 'freeze-tree.raw']) {
  const rows = read(`${owned}/${tree}`).toString('utf8').split('\0').filter(Boolean);
  for (const row of rows) {
    const match = /^(\d+) blob ([0-9a-f]{40})\t(.+)$/.exec(row);
    if (!match) throw new Error(`bad tree ${row}`);
    const [, mode, oid, name] = match;
    const bytes = read(name);
    const actual = crypto.createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
    if (actual !== oid) throw new Error(`Git blob mismatch ${name}`);
    records.push({ tree, name, mode, oid, bytes: bytes.length, sha256: sha(bytes) });
  }
}
const archive = read(`${packet}/output/package/virtual-bash-0.0.0.tgz`, 909885);
if (archive.length !== 909885 || sha(archive) !== 'fc559bb3a1bd7db72e959461ce2b733871cde0867095c61fd065021fb498606d') throw new Error('archive pin');
const predecode = read(`${packet}/output/PRE-INFLATE-RECEIPT.json`, 821512);
if (sha(predecode) !== '52b75de5a8b9af27effc7d5dcf5ffa64eeb8171383413810709143b144fef54d') throw new Error('predecode pin');
fs.writeFileSync(`${owned}/ADMISSIONS.json`, JSON.stringify({ schema: 1, time: new Date().toISOString(), records, archiveDecoded: false }, null, 2) + '\n', { flag: 'wx' });
const texts = [];
for (const record of records.filter(item => item.tree === 'final-tree.raw')) {
  if (record.name.endsWith('.json') && !record.name.includes('/layouts/') && !record.name.includes('/cells/')) {
    const value = JSON.parse(read(record.name));
    const summary = Array.isArray(value) ? { length: value.length, first: value[0] } : Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, Array.isArray(entry) ? { length: entry.length, first: entry[0] } : entry]));
    texts.push(`\n--- ${record.name} ---\n${JSON.stringify(summary, null, 2)}`);
  }
}
fs.writeFileSync(`${owned}/manifest-summaries.txt`, texts.join('\n'), { flag: 'wx' });
const names = records.filter(item => item.tree === 'final-tree.raw').map(item => item.name);
fs.writeFileSync(`${owned}/packet-paths.txt`, names.join('\n') + '\n', { flag: 'wx' });
console.log(JSON.stringify({ records: records.length, finalFiles: names.length, archiveBytes: archive.length, archiveDecoded: false, summariesBytes: Buffer.byteLength(texts.join('\n')) }));
for (const name of names.filter(name => !name.includes('/layouts/'))) console.log(name);
