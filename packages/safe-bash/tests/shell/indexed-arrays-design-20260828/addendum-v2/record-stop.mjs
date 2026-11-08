import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const directory = path.dirname(fileURLToPath(import.meta.url));
const workspace = '/Users/kjopek/Workspace/safe-bash';
const observation = path.join(directory, '../native-observations-v1');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const relative = filename => path.relative(workspace, filename);
const readJson = filename => JSON.parse(fs.readFileSync(filename, 'utf8'));
const record = filename => {
  const bytes = fs.readFileSync(filename);
  return { path: relative(filename), bytes: bytes.length, sha256: hash(bytes) };
};
const exclusive = (filename, bytes) => {
  const descriptor = fs.openSync(filename, 'wx', 0o600);
  try { fs.writeFileSync(descriptor, bytes); fs.fsyncSync(descriptor); }
  finally { fs.closeSync(descriptor); }
};
const stop = readJson(path.join(directory, 'FINAL-STOP.json'));
const evidence = readJson(path.join(observation, 'EVIDENCE.json'));
const seal = readJson(path.join(observation, 'SEAL.json'));
if (stop.status !== 'STOPPED_FINAL_INTEGRITY') throw new Error('Only stopped-result recording is supported');

if (process.argv[2] === 'record-binding') {
  const report = fs.readFileSync(path.join(directory, 'REPORT.md'), 'utf8');
  const reportWords = report.trim().split(/\s+/).length;
  if (reportWords > 700) throw new Error('report exceeds 700 words');
  const findingsPath = 'tests/shell/indexed-arrays-independent-20260828/FINDINGS.md';
  const findingLines = fs.readFileSync(path.join(workspace, findingsPath), 'utf8').split('\n');
  const anchors = {
    G1: ['R runtime.ts:1301', 'R runtime.ts:1935'],
    G2: ['R runtime.ts:160', 'R runtime.ts:293', 'R runtime.ts:297', 'R runtime.ts:2342'],
    G3: ['R runtime.ts:278', 'R runtime.ts:794', 'R runtime.ts:817', 'R runtime.ts:824'],
    G4: ['R runtime.ts:135', 'R runtime.ts:2508', 'R runtime.ts:2525', 'R runtime.ts:2658'],
    G5: ['B cleanup.ts:33', 'B cleanup.ts:46', 'abe53e03 addendum-v1/ACCOUNTING.md:59', 'abe53e03 addendum-v1/ACCOUNTING.md:72'],
    G6: ['R runtime.ts:29', 'R runtime.ts:62', 'B shell.ts:162'],
    G7: ['R runtime.ts:1046', 'R runtime.ts:1049', 'R runtime.ts:1293', 'R runtime.ts:1379', 'R runtime.ts:1479', 'R runtime.ts:2245', 'R runtime.ts:2331', 'R runtime.ts:2441'],
    G8: ['B parser.ts:6', 'B parser.ts:274', 'B parser.ts:439', 'R runtime.ts:309', 'R runtime.ts:824', 'R runtime.ts:2512'],
  };
  const findings = findingLines.flatMap((line, index) => {
    const match = /^## (G[1-8]) — (.*)$/.exec(line);
    return match ? [{ id: match[1], title: match[2], path: findingsPath, line: index + 1,
      revision: '0d70a9d4d30f4623a5ec2594e7f8568f5e2dbb43', status: 'OPEN_FOR_ROOT', sourceAnchors: anchors[match[1]] }] : [];
  });
  if (findings.length !== 8) throw new Error('finding count mismatch');
  const binding = {
    schema: 'indexed-array-additive-response-binding-v2-stopped', createdAt: new Date().toISOString(),
    status: 'STOPPED_FINAL_INTEGRITY', qualification: 'Carried historical identities plus authored-document hashes only; not a retry, repaired guard, fresh final-tree seal or product approval',
    stop: record(path.join(directory, 'FINAL-STOP.json')), reportWords,
    commits: { original: '2cb939883a91b495bed7dadb8973cd1939b16e6a', preseal: 'abe53e03b654cd576dfa5f8f7a6cf435edc2b4d0', review: '0d70a9d4d30f4623a5ec2594e7f8568f5e2dbb43', supervisorSeal: evidence.sealCommit, evidence: stop.captureEvidenceCommit },
    manifestSha256: evidence.manifestSha256, evidenceSha256: stop.captureEvidenceSha256,
    acceptedComposition: evidence.sourceComposition, sourceBlobsCarriedFromCompletedSeal: seal.authentication.sources,
    anchorConvention: 'R=c26892c3 runtime; B=5137a74e other src/shell paths. Exact revisions/hashes in carried source rows; never current HEAD.',
    findingResponses: findings,
    authored: ['REPORT.md', 'DECISIONS.md', 'FINAL-STOP.json', 'bind-metadata.mjs', 'record-stop.mjs'].map(name => record(path.join(directory, name))),
    captureTotalsCarried: evidence.totals, originalEvidencePreservation: 'No writes to original2cb93988/abe53e03/0d70a9d4 or capture. Sixteen historical source/review files reauthenticated before stopped census; remaining final binder checks not reached.',
    rootSettled: ['fresh ledger per independent public Shell.exec; shared within internal descendants/invoke', 'staged target publication, RHS once, completed RHS effects not rolled back', 'scalar assignment sequence unchanged', 'canonical literal indices 0..2147483647 and explicit exclusions'],
    tests: 0, productCalls: 0, productImports: 0, nativeAdditionalCalls: 0,
    implementationApproval: false, eightFindingsClosed: false, crossExecOrRSSClaim: false,
  };
  const destination = path.join(directory, 'BINDINGS.json');
  exclusive(destination, `${JSON.stringify(binding, null, 2)}\n`);
  console.log(JSON.stringify({ status: binding.status, path: relative(destination), sha256: hash(fs.readFileSync(destination)), reportWords, findings: findings.map(finding => finding.id), guardRetried: false }));
} else if (process.argv[2] === 'final-receipt') {
  const revision = process.argv[3];
  if (!/^[0-9a-f]{40}$/.test(revision ?? '')) throw new Error('exact recorded additive commit required');
  const binding = readJson(path.join(directory, 'BINDINGS.json'));
  const destination = '/tmp/indexed-arrays-observations-20260828-candidate.txt';
  const lines = [
    'Indexed-array delegated leaf receipt — August 28, 2026',
    'Scoped status: native cohort observed; FINAL ADDITIVE BINDING STOPPED CLOSED; eight findings remain OPEN; NO implementation approval.',
    `Supervisor/preflight seal: ${evidence.sealCommit}`,
    `Evidence commit: ${stop.captureEvidenceCommit}`,
    `Additive response/stop commit: ${revision} (supplied Git receipt identity, not a final-tree reauthentication).`,
    `Manifest SHA256: ${evidence.manifestSha256} at ${binding.commits.preseal}; independent review ${binding.commits.review}.`,
    `Evidence SHA256: ${binding.evidenceSha256}; additive binding SHA256: ${hash(fs.readFileSync(path.join(directory, 'BINDINGS.json')))}`,
    `Accepted sources: base ${binding.acceptedComposition.base}, CD ${binding.acceptedComposition.cd}, LET ${binding.acceptedComposition.let}.`,
    `Accepted runtime SHA256: ${binding.acceptedComposition.runtimeSha256}; not mixed HEAD.`,
    `Binary SHA256: ${seal.authentication.binary.sha256}; manual SHA256: ${seal.authentication.manual.sha256}.`,
    'GNU5.3 on Darwin25.4.0/arm64 only; no Linux/full-Bash, async-parent-mutation, cancellation or resource claim.',
    'N01–N16 once, 1783 script bytes; 14 exit0, N12/N15 exit127; no signals, expected values or pass denominator.',
    'stdout3247 + stderr468 =3715 bytes. One five-byte kept\\n file effect captured before deletion; fixture peak4 entries.',
    'All16 top-level children naturally exited/reaped; known groups absent at recorded closure; zero TERM/KILL. Exact owned-file/empty-directory cleanup removed fixture root.',
    'Two Bash-managed substitution contexts are predeclared by scripts, not independently counted processes. No native rerun, additional oracle or dormant task worker.',
    'Maximum row18.907584ms, summed201.376081ms. Capture-time pre/post identities/addition-aware census NO_DRIFT.',
    'LATER FINAL STOP: protected root gained observation-review-v1. Names only inspected; foreign contents not read. Binding exit1 preserved; no ignore-list change, binding retry or guard bypass.',
    'Final stopped binder completed16 historical file/blob checks, then refused new-entry census; later evidence/source/binary final checks were not reached. Historical capture success is not fresh final-tree approval.',
    'Original2cb93988/abe53e03/0d70a9d4 files and all captures preserved. No platform block; initial metadata zsh path typo recorded.',
    'tests=0; productCalls=0; productImports=0; no builds/comparator/private checkout/XAN access. Alias/dotglob unchanged; STACK locked, DOTGLOB next.',
    `Report: ${relative(path.join(directory, 'REPORT.md'))} (${binding.reportWords} words).`,
    `Details: ${relative(path.join(directory, 'DECISIONS.md'))}; G1–G8 anchors: ${relative(path.join(directory, 'BINDINGS.json'))}; stop: ${relative(path.join(directory, 'FINAL-STOP.json'))}.`,
    'Pending root: G1 overflow/status phases; G2 watched identities; G3 snapshots; G4 expression ownership; G5 cleanup/checkpoints; G6 private failure; G7 scalar boundaries; G8 grammar/operators; plus final metadata-boundary disposition.',
    'Fresh public-exec ledger boundary and staged publication/no RHS rollback are root directions, not native-derived approval. No further native execution or product work authorized.',
    `Generated ${new Date().toISOString()}; separate from CLI -o final path.`,
    '',
  ];
  const text = lines.join('\n');
  exclusive(destination, text);
  console.log(JSON.stringify({ status: stop.status, receipt: destination, bytes: Buffer.byteLength(text), sha256: hash(text), guardRetried: false, nativeAdditionalCalls: 0 }));
} else {
  throw new Error('Only record-binding or final-receipt of the preserved stop is supported');
}
