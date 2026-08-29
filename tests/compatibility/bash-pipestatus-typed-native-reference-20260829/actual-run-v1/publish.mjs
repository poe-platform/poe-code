import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
const own = path.resolve('tests/compatibility/bash-pipestatus-typed-native-reference-20260829/actual-run-v1');
const root = '/private/tmp/safe-bash-pipestatus-typed-observations-20260829-v1';
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const inventory = []; let total = 0;
const publication = `${own}/native-artifacts`;
fs.mkdirSync(publication, { mode: 0o700 });
function copy(relative = '') {
  for (const name of fs.readdirSync(path.join(root, relative)).sort()) {
    const item = path.join(relative, name); const source = path.join(root, item); const stat = fs.lstatSync(source);
    if (stat.isSymbolicLink() || inventory.length > 4096 || stat.uid !== process.getuid()) throw Error('ARTIFACT_AUTHORITY');
    if (stat.isDirectory()) { inventory.push({ path: item, type: 'directory', mode: stat.mode & 511 }); fs.mkdirSync(path.join(publication, item), { mode: 0o700 }); copy(item); }
    else {
      if (!stat.isFile() || stat.nlink !== 1 || stat.size > 1048576 || (total += stat.size) > 33554432) throw Error('ARTIFACT_CAP');
      const bytes = fs.readFileSync(source); const after = fs.lstatSync(source);
      if (bytes.length !== stat.size || after.ino !== stat.ino || after.mtimeMs !== stat.mtimeMs) throw Error('ARTIFACT_RACE');
      const destination = path.join(publication, item + '.data');
      const descriptor = fs.openSync(destination, 'wx', 0o600);
      try { fs.writeFileSync(descriptor, bytes); fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); }
      inventory.push({ path: item, type: 'file', mode: stat.mode & 511, bytes: bytes.length, sha256: hash(bytes), copiedAs: path.relative(own, destination) });
    }
  }
}
copy();
function data(relative) {
  const row = inventory.find(item => item.path === relative && item.type === 'file');
  if (!row) throw Error(`MISSING:${relative}`);
  const bytes = fs.readFileSync(path.join(own, row.copiedAs));
  if (hash(bytes) !== row.sha256) throw Error('COPY_HASH'); return bytes;
}
const results = JSON.parse(data('RESULTS.json'));
const observations = [];
for (const id of ['P19', 'P20', 'P21', 'P22', 'P23', 'P24']) {
  const row = JSON.parse(data(`${id}.json`));
  const channels = {};
  for (const channel of ['stdout', 'stderr']) {
    const files = inventory.filter(item => item.type === 'file' && item.path.startsWith(`captures/${id}/`) && path.basename(item.path).includes(channel));
    if (files.length !== 1) throw Error(`CHANNEL:${id}:${channel}`);
    const bytes = data(files[0].path);
    channels[channel] = { bytes: bytes.length, sha256: hash(bytes), base64: bytes.toString('base64'), text: bytes.toString('utf8') };
  }
  observations.push({ id, status: row.status, retired: row.retired, stop: row.stop, regularCaptureCompletion: row.regularCaptureCompletion, ...channels });
}
const journal = data('JOURNAL.jsonl').toString('utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
const start = journal.find(row => row.event === 'AUTHENTICATED_START');
const deadline = Math.min(start.started + 600000, Date.parse('2026-08-29T15:03:40.912Z'));
if (Date.now() > deadline) throw Error('PUBLICATION_DEADLINE');
const manifest = { schema: 'typed6-native-observation-publication-v1', at: new Date().toISOString(), source: 'e10e371dc9c70583681add9c1747c85a710b1f59', bindingCommit: '32ceae3a52c52e9cb23f327801c1d1b80238143c', slotCommit: 'e0f1dc4b4228ef346d752bd82346b1d8b1902e4e', observations, results, journal, inventory, rawBytes: total, deadline, interpretation: 'OBSERVATIONS_NOT_PASSES_NO_POLICY_SELECTED', version: 'previously authenticated local Bash3.2.57; no version probe', processQualification: 'owner+six managed case processes; four source-fork reservations UNOBSERVED; not OS census', initialToolShell: 'TRUSTED_HOST_OUTSIDE_CHILD_FRESH_ENV_AND_RAW_CAPTURE', knownOwnerRetirement: 'exec tool must separately confirm owner exit/close; no signal-only credit' };
function write(name, value) {
  if (Date.now() > deadline) throw Error('PUBLICATION_DEADLINE');
  const descriptor = fs.openSync(path.join(own, name), 'wx', 0o600);
  try { fs.writeFileSync(descriptor, value); fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); }
  if (Date.now() > deadline) throw Error('PUBLICATION_DEADLINE');
}
write('OBSERVATIONS.json', JSON.stringify(manifest, null, 2) + '\n');
write('HANDOFF.md', `# Typed6 native observations\n\nOne approved local Bash3.2.57 attempt; six observations, not parity passes. No expected native matrix or implementation policy selected. Exact stdout/stderr bytes, statuses, lifecycle records, source identities, UTC deadline and raw inventory are retained in OBSERVATIONS.json and native-artifacts. Raw data was copied and hashed before semantic metadata extraction.\n\nOwner tool exit/close is separately retained in its tool transcript. Six managed case exit/close/group observations are retained without treating the four source-stage reservations as observed processes. No GNU5.3/hidden-state/all-platform or containment inference. No repeat version probe, product/Worker/compiler/build/network activity. Initial tool startup is trusted host outside the clean-child/raw-capture qualification.\n\nOriginal typed preexec/slot results and older native26 ambiguities remain immutable. A different artifact audit and ROOT adjudication remain required.\n`);
console.log(JSON.stringify({ observations, completed: results.completed, halted: results.halted, ledger: results.ledger, rawBytes: total, deadline }, null, 2));
