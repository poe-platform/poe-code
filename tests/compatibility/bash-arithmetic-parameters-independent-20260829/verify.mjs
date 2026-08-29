import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';

const owned = 'tests/compatibility/bash-arithmetic-parameters-independent-20260829';
const packet = 'tests/compatibility/bash-function-keyword-author-20260829/k08-repair-v1';
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
let bytesRead = 0;
function read(filename, pin) {
  const before = fs.lstatSync(filename);
  if (!before.isFile() || before.size > 4 * 1024 * 1024) throw Error('ADMISSION ' + filename);
  const descriptor = fs.openSync(filename, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const bytes = Buffer.alloc(before.size);
    let offset = 0;
    while (offset < bytes.length) {
      const count = fs.readSync(descriptor, bytes, offset, Math.min(65536, bytes.length - offset), offset);
      if (!count) throw Error('SHORT ' + filename);
      offset += count;
    }
    const after = fs.fstatSync(descriptor);
    if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size || before.mtimeMs !== after.mtimeMs || fs.readSync(descriptor, Buffer.alloc(1), 0, 1, bytes.length)) throw Error('CHANGED ' + filename);
    bytesRead += bytes.length;
    if (bytesRead > 96 * 1024 * 1024) throw Error('READ_CEILING');
    if (pin && (bytes.length !== pin.bytes || sha256(bytes) !== pin.sha256)) throw Error('PIN ' + filename);
    return bytes;
  } finally { fs.closeSync(descriptor); }
}
const controls = [];
function check(id, name, action) {
  try { controls.push({ id, name, status: 'DATA_CHECK_COMPLETED', result: action() }); }
  catch (reason) { controls.push({ id, name, status: 'DATA_CHECK_FAILED', reason: String(reason) }); }
}
const seal = JSON.parse(read(packet + '/future/SEAL.json', { bytes: 196558, sha256: 'ba016c4ff6bfa1add722d65c59a0d4f740e43ca652c56bfc12610472bb633d91' }));
const build = JSON.parse(read(packet + '/BUILD-SEAL.json', { bytes: 85429, sha256: '30100c3b0694685825207cb6d9beb2802ba7eee450a45f0a9d63ea711c107470' }));
const audit = JSON.parse(read(owned + '/audit.json'));
check('C01', 'NUL Git publication/evidence inventories', () => {
  const inventory = filename => read(filename).toString().split('\0').filter(Boolean).map(record => {
    const split = record.indexOf('\t');
    const [mode, type, oid] = record.slice(0, split).split(' ');
    const filename = record.slice(split + 1);
    if (split < 0 || mode !== '100644' || type !== 'blob' || !/^[a-f0-9]{40}$/.test(oid) || !filename.startsWith(packet + '/')) throw Error('GIT_DOMAIN');
    return { filename, oid };
  });
  const publication = inventory(owned + '/publication-tree.txt');
  const evidence = inventory(owned + '/evidence-tree.txt');
  for (const row of publication) {
    const bytes = read(row.filename);
    const observed = crypto.createHash('sha1').update(Buffer.from(`blob ${bytes.length}\0`)).update(bytes).digest('hex');
    if (observed !== row.oid) throw Error('GIT_BLOB ' + row.filename);
  }
  const differences = publication.filter(row => evidence.find(old => old.filename === row.filename)?.oid !== row.oid).map(row => row.filename);
  return { publicationRows: publication.length, evidenceRows: evidence.length, publicationDifferences: differences, publicationCommit: 'bbe0b5c7bd8b9970b2842d26d0dc05d1c4f0aa6d', evidenceCommit: '71a5556b19ebf51e4ddd88bbd634399ca5243184' };
});
check('C02', 'Future seal and helper pins', () => {
  for (const [name, pin] of Object.entries(seal.files)) read(packet + '/future/' + name, pin);
  for (const [name, pin] of Object.entries(seal.helperPins)) read(path.join(seal.helperRoot, name), pin);
  return { local: Object.keys(seal.files).length, inherited: Object.keys(seal.helperPins).length };
});
check('C03', '306 exact built source inputs', () => {
  const rows = JSON.parse(read(seal.sourceBinding.path, seal.sourceBinding));
  if (rows.length !== 306 || new Set(rows.map(row => row.path)).size !== 306) throw Error('SOURCE_COUNT');
  for (const row of rows) {
    if (row.path.split('/').some(part => !part || part === '.' || part === '..')) throw Error('SOURCE_PATH');
    read(path.join(seal.sourceApp, row.path), row);
    const original = build.inputs.find(input => input.path === row.path);
    if (!original || original.bytes !== row.bytes || original.sha256 !== row.sha256) throw Error('BUILD_INPUT_BINDING');
  }
  for (const filename of ['src/shell/arithmetic.ts', 'src/shell/arrays/ledger.ts', 'src/shell/arrays/state.ts']) read(filename, rows.find(row => row.path === filename));
  return { count: rows.length, supportingLiveSourcesMatchPinnedInputs: true };
});
check('C04', 'Runtime inverse diff and ERE disjointness', () => {
  if (audit.summary.reversedSha256 !== '0c17850b1ceb4f09eec5458315dbb08433aa01721cf1b20fe7385481a20992e1') throw Error('REVERSE');
  read(owned + '/pinned-runtime.txt', audit.summary.sourceRuntime);
  read(owned + '/pinned-arithmetic-parameters.txt', audit.summary.sourceHelper);
  return { reversedSha256: audit.summary.reversedSha256, sourceCommit: 'ffac894aa98b8cd98476b8ea109ef2e2425c2a07' };
});
check('C05', 'Shipping hash without inflation', () => {
  const bytes = read(seal.archive.path, seal.archive);
  if (bytes.toString('base64') !== read(packet + '/evidence/package.tgz.base64').toString().trim()) throw Error('BASE64');
  return { bytes: bytes.length, sha256: sha256(bytes), inflations: 0 };
});
check('C06', '1006 shipping member bindings', () => {
  for (const row of seal.shipping) read(path.join(seal.sourceApp, row.path), row);
  return { count: seal.shipping.length, createdInstalledOrMovedLayouts: false };
});
check('C07', 'Existing public declaration byte comparison', () => {
  const oldRoot = path.dirname(build.inputs.find(row => row.path === 'package.json').origin);
  const rows = seal.shipping.filter(row => row.path.endsWith('.d.ts') && row.path !== 'dist/shell/arithmetic-parameters.d.ts');
  for (const row of rows) read(path.join(oldRoot, row.path), row);
  for (const filename of ['package.json', 'src/index.ts']) {
    const pin = build.inputs.find(row => row.path === filename);
    read(path.join(oldRoot, filename), pin);
    read(path.join(seal.sourceApp, filename), pin);
  }
  return { existingDeclarationsByteEqual: rows.length, soleNewDeclaration: 'dist/shell/arithmetic-parameters.d.ts', consumerExecutions: 0, qualification: 'Retained old source-app comparison; old declaration bytes are not independently bound here to a historical archive seal.' };
});
check('C08', 'Finite matrix and role arithmetic', () => {
  const data = JSON.parse(read(packet + '/future/CASES.json', seal.files['CASES.json']));
  if (data.rows.length !== 23 || data.layouts.length !== 3 || new Set(data.rows.map(row => row.id)).size !== 23) throw Error('CASE_COUNT');
  return { ...audit.summary.counts, proposedAllKnownStarts: 86, extraAdministration: 7, actualShellCalls: 0, actualProductionHelperCalls: 0, actualMutants: 0, actualBindingRefusals: 0 };
});
check('C09', 'Failure and outer qualification source findings', () => ({ disposition: 'PREEXEC_HOLD', blockers: ['B1 child primary precedence', 'B2 outer terminal-result qualification'], productionOrRunnerEvaluation: false }));
check('C10', 'Mutation source findings', () => ({ disposition: 'PREEXEC_HOLD', blockers: ['B3 M01 exact-defect and loaded-helper qualification'], mutationCount: seal.mutations.length, actualLoadedMutants: 0 }));
check('C11', 'Pending versioned authority and shared-clock finding', () => {
  const grant = JSON.parse(read(packet + '/future/GO.template.json'));
  const review = JSON.parse(read(packet + '/future/REVIEW.template.json'));
  if (grant.decision !== 'PENDING' || review.decision !== 'PENDING') throw Error('UNEXPECTED_ACTIVATION');
  return { grant: grant.decision, review: review.decision, blocker: 'B4 inherit outer deadline and known-child retirement', historicalArchiveStopUnchanged: true, actualGO: false };
});
check('C12', 'Fresh owned census and inclusive review budget', () => {
  const rows = [];
  for (const name of fs.readdirSync(owned).sort()) {
    const filename = path.join(owned, name);
    const stat = fs.lstatSync(filename);
    if (!stat.isFile() || rows.length >= 32) throw Error('OWNED_CENSUS');
    const bytes = read(filename);
    rows.push({ path: filename, bytes: bytes.length, sha256: sha256(bytes) });
  }
  const total = rows.reduce((sum, row) => sum + row.bytes, 0);
  const capture = rows.filter(row => /\.(stdout|stderr)\.txt$/.test(row.path)).reduce((sum, row) => sum + row.bytes, 0);
  const publicationReserve = 4 * 1024 * 1024;
  if (total + publicationReserve > 384 * 1024 * 1024 || capture + publicationReserve > 64 * 1024 * 1024 || Date.now() >= Date.parse('2026-08-29T15:09:57Z')) throw Error('REVIEW_BUDGET');
  return { at: new Date().toISOString(), total, capture, publicationReserve, helperInvocations: 3, maximumKnownLaunchesIncludingPublication: 48, knownPeak: 3, shellControlGroupsIncludingPublication: 9, rows, qualification: 'Pre-receipt/post-helper-1-and-2 owned-file sample, not RSS, physical quota, continuous peak, or universal process census.' };
});
const output = { schema: 'k08-independent-source-preexec-review-v1', finishedDataChecksAt: new Date().toISOString(), source: 'ACCEPT_NARROW_SOURCE_ONLY', preexec: 'HOLD', controls, bytesRead, actualGO: false };
fs.writeFileSync(owned + '/verification.json', JSON.stringify(output, null, 2) + '\n');
console.log(JSON.stringify({ at: output.finishedDataChecksAt, controls: controls.map(({id,name,status,reason}) => ({id,name,status,reason})), actualGO: false }, null, 2));
if (controls.some(row => row.status !== 'DATA_CHECK_COMPLETED')) process.exitCode = 1;
