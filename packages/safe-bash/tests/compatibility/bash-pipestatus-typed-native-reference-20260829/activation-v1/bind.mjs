import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
const base = path.resolve('tests/compatibility/bash-pipestatus-typed-native-reference-20260829');
const own = `${base}/activation-v1`;
const directory = `${base}/materialized`;
const deadline = fs.lstatSync(`${own}/raw/startup.stdout`).birthtimeMs + 480000;
const observed = [];
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
function guard() { if (Date.now() > deadline) throw Error('PREPARATION_DEADLINE'); }
function admit(file, expected, maximum = 1048576) {
  guard();
  const descriptor = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const stat = fs.fstatSync(descriptor);
    if (!stat.isFile() || stat.nlink !== 1 || stat.size > maximum || fs.realpathSync(file) !== file) throw Error(`ADMISSION:${file}`);
    if (expected && ((expected.mode !== undefined && (stat.mode & 511) !== expected.mode) || (expected.bytes !== undefined && stat.size !== expected.bytes))) throw Error(`METADATA:${file}`);
    const bytes = fs.readFileSync(descriptor);
    const digest = hash(bytes);
    if (bytes.length !== stat.size || (expected?.sha256 && digest !== expected.sha256)) throw Error(`HASH:${file}`);
    const after = fs.fstatSync(descriptor);
    if (after.ino !== stat.ino || after.mtimeMs !== stat.mtimeMs || after.size !== stat.size) throw Error(`RACE:${file}`);
    observed.push({ path: file, bytes: bytes.length, mode: stat.mode & 511, sha256: digest });
    return bytes;
  } finally { fs.closeSync(descriptor); }
}
function streamTool(pin) {
  guard();
  const descriptor = fs.openSync(pin.path, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const stat = fs.fstatSync(descriptor);
    if (!stat.isFile() || stat.size !== pin.bytes || (stat.mode & 511) !== pin.mode) throw Error('TOOL_METADATA');
    const digest = crypto.createHash('sha256'); const buffer = Buffer.alloc(1048576); let total = 0; let count;
    while ((count = fs.readSync(descriptor, buffer)) > 0) { guard(); total += count; if (total > pin.bytes) throw Error('TOOL_GROWTH'); digest.update(buffer.subarray(0, count)); }
    const after = fs.fstatSync(descriptor);
    if (total !== pin.bytes || digest.digest('hex') !== pin.sha256 || after.ino !== stat.ino || after.mtimeMs !== stat.mtimeMs || after.size !== stat.size) throw Error('TOOL_HASH_RACE');
    observed.push({ ...pin, operation: 'fresh streaming metadata/hash; no tool execution' });
  } finally { fs.closeSync(descriptor); }
}
function put(file, value) {
  guard(); const bytes = Buffer.isBuffer(value) ? value : Buffer.from(JSON.stringify(value, null, 2) + '\n');
  const descriptor = fs.openSync(file, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600);
  try { fs.writeFileSync(descriptor, bytes); fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); }
  guard(); return { path: file, mode: 384, bytes: bytes.length, sha256: hash(bytes) };
}
const sealBytes = admit(`${directory}/PRESEAL.json`, { sha256: 'ade56f23358e284df533f7e57e462ba927fb0386899061e90699977746424b6e', mode: 384 });
const seal = JSON.parse(sealBytes);
for (const member of seal.files) admit(`${directory}/${member.path}`, member);
admit(`${base}/READY-SEAL.json`, { sha256: '798c191fdad35bdf6c1592afda1954764da2209ad18984d966e5488c5e80bdd0' });
const tools = JSON.parse(admit(`${directory}/TOOLS.json`, seal.files.find(row => row.path === 'TOOLS.json')));
for (const pin of [...tools.toolPins, tools.environmentLauncher, tools.wrapperTool]) streamTool(pin);
const reviewPath = path.resolve('tests/compatibility/bash-pipestatus-typed-native-preflight-review-20260829/RECEIPT.json');
const reviewBytes = admit(reviewPath, { sha256: '0460fca591217940e54b8a15e1c4eb19d50288b070f2714ea5ae2cde715c413c' });
const blob = crypto.createHash('sha1').update(Buffer.from(`blob ${reviewBytes.length}\0`)).update(reviewBytes).digest('hex');
if (blob !== 'c7c520bbc4512d16fd0953ba3b90de2d44a673ea') throw Error('REVIEW_STORED_BLOB');
const review = JSON.parse(reviewBytes);
if (review.decision !== 'ACCEPT_SCOPED_PREEXECUTION_ONLY' || review.source !== 'e10e371dc9c70583681add9c1747c85a710b1f59' || review.executableSha256 !== hash(sealBytes)) throw Error('REVIEW_ROLE');
const template = JSON.parse(admit(`${base}/APPROVAL-PROPOSAL.template.json`, { sha256: '8f14ef69db395a8dffd4bcd573e6944bc03bddf324ac204846c6b1c6412e6f4e' }));
const grant = JSON.parse(admit(`${base}/GO.template.json`, { sha256: '75422a2a18e06a86c1e0985072f45222e7af545b566768cfb43a8a3c67c92844' }));
const runtimeReview = JSON.parse(admit(`${base}/REVIEW-ACCEPTANCE.template.json`, { sha256: '8946073cbadad02a168b8c3fd34daa9215091e3c585e1918d8bc41899c3cd35b' }));
const protocol = JSON.parse(admit(`${directory}/PROTOCOL.json`, seal.files.find(row => row.path === 'PROTOCOL.json')));
const admission = await import(pathToFileURL(`${directory}/admission.mjs`).href);
const root = protocol.runRoot;
for (const file of [root, `${directory}/GO.json`, `${directory}/REVIEW-ACCEPTANCE.json`, `${directory}/PREPROVISION.json`]) { if (fs.existsSync(file)) throw Error(`MUST_BE_UNUSED:${file}`); }
runtimeReview.decision = 'ACCEPT';
runtimeReview.reviewer = 'ROOT-ratified independent preexec 987886897c2d013fcb31e1f2db0d073439d558db';
runtimeReview.reviewCommit = '987886897c2d013fcb31e1f2db0d073439d558db';
admission.validateReview(runtimeReview, { presealSha256: hash(sealBytes), requestsSha256: seal.files.find(row => row.path === 'REQUESTS.json').sha256 });
const reviewPin = put(`${directory}/REVIEW-ACCEPTANCE.json`, runtimeReview);
const parents = [];
for (const filename of [root, `${root}/outer`, `${root}/cases`, `${root}/captures`]) {
  guard(); fs.mkdirSync(filename, { mode: 0o700 });
  const stat = fs.lstatSync(filename, { bigint: true });
  if (!stat.isDirectory() || stat.uid !== BigInt(process.getuid()) || fs.realpathSync(filename) !== filename) throw Error('NEW_PARENT_OWNERSHIP');
  parents.push({ path: filename, device: String(stat.dev), inode: String(stat.ino), mode: Number(stat.mode & 511n) });
}
const provision = { parents }; admission.validateProvision(provision, root);
const provisionPin = put(`${directory}/PREPROVISION.json`, provision);
const journalPin = put(`${root}/JOURNAL.jsonl`, Buffer.alloc(0));
for (const channel of ['stdout', 'stderr']) if (fs.existsSync(`${root}/outer/bootstrap.${channel}`)) throw Error('PREEXISTING_CAPTURE');
const issued = Date.now();
grant.decision = 'GO'; grant.issuedEpochMs = issued; grant.deadlineEpochMs = issued + 2700000;
grant.independentReviewReceipt = reviewPin; grant.preprovision = provisionPin;
admission.validateGrant(grant, issued);
if (JSON.stringify(grant.limits) !== JSON.stringify(protocol.limits)) throw Error('LIMIT_DRIFT');
const grantPin = put(`${directory}/GO.json`, grant);
const resolved = structuredClone(template.parameters);
resolved.cmd = resolved.cmd.replace('ROOT_APPROVED_GRANT_SHA256', grantPin.sha256);
admission.resolveApproval(template, resolved, grantPin.sha256);
const resolvedPin = put(`${own}/APPROVAL-REQUEST.json`, resolved);
const commandPin = put(`${own}/command.txt.data`, Buffer.from(resolved.cmd));
const accepted = admission.admit(directory, grantPin.path, grantPin.sha256);
admission.validateProvision(accepted.provision, root);
const requests = accepted.requests;
const cohort = JSON.parse(admit(`${directory}/COHORT.json`, seal.files.find(row => row.path === 'COHORT.json')));
admission.validateCohort(cohort, requests, root);
for (const member of seal.files) admit(`${directory}/${member.path}`, member);
const window = { issued: new Date(issued).toISOString(), latestFull600sStart: new Date(issued + 2100000).toISOString(), expires: new Date(issued + 2700000).toISOString() };
const result = { schema: 'typed6-activation-binding-v1', status: 'READY_FOR_DIFFERENT_SLOT_REVIEW_NOT_ACTUAL_GO', source: 'e10e371dc9c70583681add9c1747c85a710b1f59', reviewCommit: runtimeReview.reviewCommit, originalReviewSha256: hash(reviewBytes), executableSha256: hash(sealBytes), readySha256: review.readySha256, window, runtimeReview: reviewPin, preprovision: provisionPin, journal: journalPin, rootProposal: grantPin, resolvedApproval: resolvedPin, command: commandPin, preflight: 'DATA_PASS', sourceMembers: seal.files.length, nativePrograms: requests.map(row => row.id), observations: 0, capturesAbsent: true, actualFDChecks: 'DEFERRED_TO_APPROVED_WRAPPER_AND_ENTRY', mode: '0600 binding records; 0700 new parent directories', initialToolShell: template.initialToolShellStartup, actualAuthority: 'STILL_REQUIRES_DIFFERENT_SLOT_REVIEW_ROOT_ACTUAL_GO_AND_EXACT_ESCALATED_APPROVAL', sourceUnchanged: true, retainedQualification: 'independent NUL result is transcript-only; no native result or semantic policy', preparationDeadline: new Date(deadline).toISOString() };
put(`${own}/SOURCE-TOOL-AUTH.json`, { rows: observed });
put(`${own}/BINDING.json`, result);
put(`${own}/HANDOFF.md`, Buffer.from(`# Typed6 binding-only handoff\n\nREADY for different sole-slot review; NOT actual GO.\n\nSource e10e371dc9c70583681add9c1747c85a710b1f59; preexec ${runtimeReview.reviewCommit}. All ${seal.files.length} executable members unchanged and reauthenticated before/after DATA admission. Four installed tool pins stream-hashed, never executed as native references. Imported only the admitted pure admission helper; entry/lifecycle/native code not run.\n\nIssued ${window.issued}; latest full-600s start ${window.latestFull600sStart}; expiry ${window.expires}. Frozen 45-minute interval unchanged. All exact pin sizes/hashes and resolved command are in BINDING.json, APPROVAL-REQUEST.json and command.txt.data (no trailing LF).\n\nRuntime ROOT-proposal decision field GO is the frozen executable schema, not additional execution permission: DIFFERENT slot ACCEPT, fresh ROOT actual GO, fresh preflight and exact require_escalated/login:false/no-prefix tool approval remain mandatory. Review→GO→command binding is acyclic. Only the designated command hash slot changed. No receipt/program/module/limit semantic changes.\n\nFresh owned root ${root} has only four mode0700 directories and an empty mode0600 JOURNAL.jsonl. Bootstrap captures remain absent. No capture FD was opened; actual inode/one-byte positional-read checks remain deferred. Retain this unused provision for review; do not automatically remove/reuse it. No child or descriptor remains active.\n\nActual proposal: 600s inclusive, 29 slots = 7 managed + 4 UNOBSERVED source-fork reservations + 18 administrative, peak5 proposal not OS quota/census; 64KiB per stream, 32MiB capture, 128MiB work; case3s TERM2/KILL1. Six P19–P24 literals, no prologue, zero input fixtures/effects/lookups, no expected outputs. Initial tool/zsh startup trusted host outside child environment/raw-capture qualification. Native observations remain 0; NUL preexec qualification remains transcript-only.\n\nPreparation source reads were followed by full frozen SHA/mode/size admission before any imported helper. Administrative process-image count is conservatively at most22 through publication; exec replacement shares process identity. All known sessions retire before final handoff; no full OS census is claimed. Raw final publication capture must be sealed only after its writer closes. No native/version/product/Worker/build/network activity.\n`));
guard(); console.log(JSON.stringify(result, null, 2));
