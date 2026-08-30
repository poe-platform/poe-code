import { openSync, closeSync, fstatSync, readSync, writeFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';

const repository = '/Users/kjopek/Workspace/safe-bash';
const owned = resolve(repository, 'tests/integration/agent-bash-coherent-author-20260829/stage-b1-actual-v5');
const work = '/private/tmp/safe-bash-coherent-b1-public15-20260829-r2';
const observations = [];
let admittedBytes = 0;
function admit(path, maximum = 1048576) {
  let descriptor;
  try {
    descriptor = openSync(path, 'r');
    const stat = fstatSync(descriptor);
    if (!stat.isFile() || stat.size > maximum || admittedBytes + stat.size > 8388608) throw new Error('metadata admission refused');
    const buffer = Buffer.alloc(stat.size);
    let offset = 0;
    while (offset < buffer.length) {
      const count = readSync(descriptor, buffer, offset, buffer.length - offset, offset);
      if (count === 0) throw new Error('short metadata read');
      offset += count;
    }
    const after = fstatSync(descriptor);
    if (after.size !== stat.size || after.mtimeMs !== stat.mtimeMs) throw new Error('metadata changed during admission');
    admittedBytes += buffer.length;
    const receipt = { path, bytes: buffer.length, sha256: createHash('sha256').update(buffer).digest('hex') };
    observations.push(receipt);
    writeFileSync(resolve(owned, `final-read-${observations.length}.receipt.json`), JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx' });
    return buffer;
  } catch (error) {
    if (error?.code === 'ENOENT') { observations.push({ path, state: 'ABSENT' }); return undefined; }
    throw error;
  } finally { if (descriptor !== undefined) closeSync(descriptor); }
}
const paths = [
  `${work}/publication-preimport-v3.stdout`, `${work}/publication-preimport-v3.stderr`,
  `${work}/publication-observer-v3.stdout`, `${work}/publication-observer-v3.stderr`,
  '/private/tmp/coherent-b1-publication-v2-20260829.startup.stdout',
  '/private/tmp/coherent-b1-publication-v2-20260829.startup.stderr',
  '/private/tmp/coherent-b1-publication-v2-20260829-results/FINAL.json',
  '/private/tmp/coherent-b1-publication-v2-20260829-results/TERMINAL.json',
  `${work}/STOP.json`, `${work}/RESULT.json`,
  `${work}/capture/events.jsonl`,
  `${work}/capture/01-workflow-source-built.stdout`,
  `${work}/capture/02-workflow-installed.stdout`,
];
const readbacks = [];
for (const path of paths) {
  const buffer = admit(path);
  if (buffer !== undefined) readbacks.push({ path, text: buffer.toString('utf8') });
}
const directoryListings = [];
for (const path of ['/private/tmp/coherent-b1-publication-v2-20260829-results', resolve(repository, 'tests/integration/agent-bash-coherent-author-20260829/stage-b1-publication-v2/actual-evidence')]) {
  try {
    const names = readdirSync(path);
    if (names.length > 128) throw new Error('metadata directory census exceeds bound');
    directoryListings.push({ path, names });
    for (const name of names) {
      if (!/^(FINAL|TERMINAL|COMMIT|SUMMARY|PUBLICATION|RESULT|RECEIPT)[^/]*\.json$/i.test(name)) continue;
      const full = resolve(path, name);
      if (paths.includes(full)) continue;
      const buffer = admit(full);
      if (buffer !== undefined) readbacks.push({ path: full, text: buffer.toString('utf8') });
    }
  } catch (error) { if (error?.code === 'ENOENT') directoryListings.push({ path, state: 'ABSENT' }); else throw error; }
}
const report = { schema: 'B1-final-publication-readback-v1', utc: new Date().toISOString(), pid: process.pid, observations, directoryListings, readbacks, qualification: 'Metadata only; no runtime retry. Receipts precede parsing. This process retirement is observed by the outer tool, not inferred here.' };
writeFileSync(resolve(owned, 'FINAL-PUBLICATION-READBACK.json'), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
for (const row of readbacks) {
  if (row.path.includes('workflow-')) {
    const parsed = JSON.parse(row.text);
    console.log(JSON.stringify({ path: row.path, keys: Object.keys(parsed), result: parsed }));
  } else console.log(JSON.stringify(row));
}
console.log(JSON.stringify({ directoryListings, admittedBytes, utc: report.utc, pid: process.pid }));
