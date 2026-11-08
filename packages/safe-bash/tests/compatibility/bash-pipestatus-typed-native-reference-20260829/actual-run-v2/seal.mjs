import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
const base = path.resolve('tests/compatibility/bash-pipestatus-typed-native-reference-20260829');
const own = `${base}/actual-run-v2`;
const deadline = 1788014344559.4192;
function guard() { if (Date.now() > deadline) throw Error('PHASE_DEADLINE'); }
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
function read(file, expected, maximum = 1048576) {
  guard(); const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > maximum) throw Error('POST_TYPE');
  const bytes = fs.readFileSync(file);
  if (bytes.length !== stat.size || (expected && sha(bytes) !== expected)) throw Error('POST_HASH');
  return bytes;
}
const seal = JSON.parse(read(`${base}/materialized/PRESEAL.json`, 'ade56f23358e284df533f7e57e462ba927fb0386899061e90699977746424b6e'));
for (const member of seal.files) {
  const bytes = read(`${base}/materialized/${member.path}`, member.sha256);
  if (bytes.length !== member.bytes || (fs.lstatSync(`${base}/materialized/${member.path}`).mode & 511) !== member.mode) throw Error('POST_MODE_SIZE');
}
read(`${base}/activation-v1/APPROVAL-REQUEST.json`, 'ad70f95598e5d13de49184034b350be21e15a6af8c035a3212e35cf9ffcd8591');
const admission = await import(pathToFileURL(`${base}/materialized/admission.mjs`).href);
const tools = JSON.parse(read(`${base}/materialized/TOOLS.json`, seal.files.find(row => row.path === 'TOOLS.json').sha256));
for (const pin of [...tools.toolPins, tools.environmentLauncher, tools.wrapperTool]) { guard(); admission.pinned(pin.path, pin); }
const observations = JSON.parse(read(`${own}/OBSERVATIONS.json`, null, 1048576));
if (observations.results?.completed !== 6 || observations.results.halted || observations.observations.some(row => !row.retired || row.stop !== null || !row.regularCaptureCompletion)) throw Error('NATIVE_COMPLETION');
const exclusions = ['SEAL.json', 'raw/sealing.stdout', 'raw/sealing.stderr', 'raw/publication.stdout', 'raw/publication.stderr'];
const rows = []; let bytesTotal = 0;
function walk(relative = '') {
  for (const name of fs.readdirSync(path.join(own, relative)).sort()) {
    guard(); const item = path.join(relative, name); if (exclusions.includes(item)) continue;
    const stat = fs.lstatSync(path.join(own, item));
    if (stat.isSymbolicLink() || rows.length > 4096) throw Error('EVIDENCE_TYPE');
    if (stat.isDirectory()) { walk(item); continue; }
    const bytes = read(path.join(own, item)); bytesTotal += bytes.length;
    if (bytesTotal > 134217728) throw Error('EVIDENCE_CAP');
    rows.push({ path: item, bytes: bytes.length, mode: stat.mode & 511, sha256: sha(bytes) });
  }
}
walk();
const result = { schema: 'typed6-native-evidence-seal-v2', at: new Date().toISOString(), phaseDeadline: deadline, sourceMembersReauthenticated: seal.files.length, toolPinsReauthenticated: 4, completion: 'six qualified owner observations; owner exit0 separately in tool transcript', rows, logicalBytes: bytesTotal, exclusions, observedStarts: { administrativeThroughFinalCommit: 18, managed: 7, reservedNotObserved: 4, totalProposal: 29 }, oldHoldUnchanged: true };
guard(); const bytes = Buffer.from(JSON.stringify(result, null, 2) + '\n'); const descriptor = fs.openSync(`${own}/SEAL.json`, 'wx', 0o600);
try { fs.writeFileSync(descriptor, bytes); fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); }
guard(); console.log(JSON.stringify({ sealSha256: sha(bytes), rows: rows.length, logicalBytes: bytesTotal, at: result.at, phaseDeadline: deadline }));
