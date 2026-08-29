import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const root = path.resolve('tests/shell/pipestatus-independent-20260829');
const publication = path.join(root, 'publication-v1');
const start = fs.statSync(path.join(publication, 'startup.stdout')).birthtimeMs;
const deadline = start + 270000;
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const members = [];
let total = 0;
function visit(directory) {
  for (const name of fs.readdirSync(directory).sort()) {
    const file = path.join(directory, name);
    const relative = path.relative(root, file);
    if (relative.startsWith('publication-v1/')) continue;
    if (name === 'AGENTS.md') throw new Error('INSTRUCTION_ARTIFACT');
    const stat = fs.lstatSync(file);
    if (stat.isSymbolicLink()) throw new Error('SYMLINK');
    if (stat.isDirectory()) { visit(file); continue; }
    if (!stat.isFile() || stat.size > 12582912 || members.length >= 256) throw new Error('FILE_CAP');
    total += stat.size;
    if (total > 67108864 || Date.now() >= deadline) throw new Error('PUBLICATION_CAP');
    const bytes = fs.readFileSync(file);
    if (bytes.length !== stat.size) throw new Error('CHANGED_SIZE');
    members.push({ path: relative, bytes: bytes.length, mode: stat.mode & 511, sha256: digest(bytes), commit: !relative.startsWith('frozen-source/') });
  }
}
visit(root);
const put = (name, value) => {
  if (Date.now() >= deadline) throw new Error('DEADLINE');
  fs.writeFileSync(path.join(publication, name), JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
};
put('CHECKPOINT-MANIFEST.json', { role: 'retained-owned-evidence-publication-not-runtime-census', members, bytes: total });
const bindings = ['HANDOFF.md', 'CHECKPOINT-MANIFEST.json', 'seal.mjs'].map(name => {
  const bytes = fs.readFileSync(path.join(publication, name));
  return { path: `publication-v1/${name}`, bytes: bytes.length, sha256: digest(bytes) };
});
const retained = ['PURE-RESULTS-v2.json', 'SOURCE-ADMISSION-v2.json', 'AUTH-v2.json', 'NATIVE-SOURCE-RECORDS.json'].map(name => members.find(row => row.path === name));
if (retained.some(row => !row)) throw new Error('MISSING_RETAINED');
put('RECEIPT.json', { schema: 'pipestatus-independent-publication-v1', at: new Date().toISOString(), source: 'ACCEPT scoped frozen completion/typed-policy mapping', pure: { verdict: 'ACCEPT', author: 24, novel: 12, total: 36, closedScopes: 38, newExecutions: 0 }, preexec: { verdict: 'HOLD', cases: 78, publicExec: 81, invoke: 3, executed: 0 }, previousPhase: { allowance: 48, conservativeChargeExhausted: true, administrativeCensusCertified: false, checkpointWasUncommitted: true, schemaRefusalPreserved: true }, bindings, retained, publication: { maximumPlannedKnownStarts: 14, peak: 1, noProductExecution: true, priorClockPrintfRefusal: 'zsh printf %(: invalid directive; before evidence capture; instruction context not copied' } });
const receipt = fs.readFileSync(path.join(publication, 'RECEIPT.json'));
console.log(JSON.stringify({ receiptBytes: receipt.length, receiptSha256: digest(receipt), checkpointMembers: members.length, checkpointBytes: total, at: new Date().toISOString() }));
