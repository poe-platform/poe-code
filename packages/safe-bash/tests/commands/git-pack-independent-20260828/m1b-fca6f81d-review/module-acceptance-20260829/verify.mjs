import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const directory = path.dirname(fileURLToPath(import.meta.url));
const repository = '/Users/kjopek/Workspace/safe-bash';
const prefix = 'tests/commands/git-pack-independent-20260828/m1b-fca6f81d-review/';
const output = path.join(directory, 'DATA-01');
const started = performance.now();
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const blobHash = bytes => createHash('sha1').update(Buffer.concat([Buffer.from('blob ' + bytes.length + '\0'), bytes])).digest('hex');
let written = 0;
let children = 0;
const receipts = [];
const documents = new Map();
function demand(value, name) { if (!value) throw new Error(name); }
function clock() { demand(performance.now() - started < 120000, 'DATA_DEADLINE'); }
async function publish(name, value, raw = false) {
  clock();
  const bytes = raw ? value : Buffer.from(JSON.stringify(value, null, 2) + '\n');
  demand(written + bytes.length <= 8388608, 'DATA_CAPTURE');
  written += bytes.length;
  await fs.writeFile(path.join(output, name), bytes, { flag: 'wx', mode: 0o600 });
}
async function regular(row) {
  clock();
  demand(!row.path.startsWith('/') && !row.path.split('/').includes('..'), 'INPUT_PATH');
  const filename = path.join(repository, row.path);
  const before = await fs.lstat(filename);
  demand(before.isFile() && !before.isSymbolicLink() && before.size <= 2097152 && await fs.realpath(filename) === filename, 'INPUT_REGULAR');
  const bytes = await fs.readFile(filename);
  const after = await fs.lstat(filename);
  demand(before.dev === after.dev && before.ino === after.ino && before.size === after.size && before.mode === after.mode && before.mtimeMs === after.mtimeMs, 'INPUT_STABILITY');
  demand((after.mode & 0o777) === row.mode && after.size === row.bytes && hash(bytes) === row.sha256 && blobHash(bytes) === row.blob, 'INPUT_BYTES_MODE');
  return bytes;
}
async function metadata(args, input) {
  clock();
  demand(++children <= 5, 'METADATA_STARTS');
  const result = spawnSync('/Library/Developer/CommandLineTools/usr/bin/git', args, { cwd: repository, input, env: { PATH: '/usr/bin:/bin', LANG: 'C', LC_ALL: 'C', GIT_OPTIONAL_LOCKS: '0', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' }, timeout: Math.min(15000, Math.max(1, 120000 - (performance.now() - started))), maxBuffer: 8388608 - written, encoding: null });
  await publish(children + '.stdout.raw', result.stdout ?? Buffer.alloc(0), true);
  await publish(children + '.stderr.raw', result.stderr ?? Buffer.alloc(0), true);
  const receipt = { args, status: result.status, signal: result.signal, error: result.error?.code ?? null };
  receipts.push(receipt);
  await publish(children + '.process.json', receipt);
  demand(result.status === 0 && result.signal === null && !result.error, 'METADATA_RETIREMENT');
  return result.stdout;
}
function document(commit, relative) {
  const bytes = documents.get(commit + ':' + prefix + relative);
  demand(bytes, 'DECLARED_DOCUMENT ' + relative);
  return JSON.parse(bytes.toString('utf8'));
}
const key = (layout, id) => layout + ':' + id;
const countBy = (rows, field) => Object.fromEntries([...new Set(rows.map(row => row[field]))].map(value => [value, rows.filter(row => row[field] === value).length]));
await fs.mkdir(output, { mode: 0o700 });
let failure = null;
let summary = null;
try {
  await publish('STARTUP.json', { role: 'SOURCE_DATA_RECONCILIATION_ONLY', candidateLoads: 0, compilerLoads: 0, nativeOracleRuns: 0, oldArchiveWrites: 0 });
  const bindingBytes = await fs.readFile(path.join(directory, 'INPUTS.json'));
  demand(hash(bindingBytes) === '2d10562576735f7e71acf3b7df29790b2c6105fb12dd788cff95c1a8b79af8bc', 'INPUT_MANIFEST_HASH');
  const binding = JSON.parse(bindingBytes);
  demand(binding.files.length === 343 && binding.origins.length === 4, 'INPUT_COUNT');
  for (const row of binding.files) {
    demand(['SOURCE_DATA', 'CAPTURE', 'READONLY_PRODUCT_SOURCE_NOT_IMPORTED'].includes(row.role) && row.gitMode === '100644' && row.mode === (row.role === 'CAPTURE' ? 0o600 : 0o644), 'ROLE_MODE');
    if (row.role !== 'READONLY_PRODUCT_SOURCE_NOT_IMPORTED') documents.set(row.commit + ':' + row.path, await regular(row));
  }
  demand(documents.size === 340 && new Set(binding.files.map(row => row.commit + ':' + row.path)).size === 343, 'NO_DUPLICATE_INPUT');
  for (const commit of binding.origins) {
    const rows = binding.files.filter(row => row.commit === commit);
    const raw = await metadata(['ls-tree', '-rz', '--full-tree', commit, '--', ...rows.map(row => row.path)]);
    const entries = raw.toString('utf8').split('\0');
    demand(entries.pop() === '', 'NUL_INVENTORY');
    const wanted = new Map(rows.map(row => [row.path, row]));
    demand(entries.length === wanted.size, 'EXACT_STORED_MEMBERSHIP');
    for (const entry of entries) {
      const tab = entry.indexOf('\t');
      const fields = entry.slice(0, tab).split(' ');
      const pathname = entry.slice(tab + 1);
      const row = wanted.get(pathname);
      demand(tab > 0 && row && fields.length === 3 && fields[0] === row.gitMode && fields[1] === 'blob' && fields[2] === row.blob, 'STORED_MEMBER');
      wanted.delete(pathname);
    }
    demand(wanted.size === 0, 'MISSING_MEMBER');
  }
  const unique = new Map(binding.files.map(row => [row.blob, row]));
  const raw = await metadata(['cat-file', '--batch'], Buffer.from([...unique.keys()].join('\n') + '\n'));
  let offset = 0;
  for (const row of unique.values()) {
    const lineEnd = raw.indexOf(10, offset);
    demand(lineEnd >= offset, 'BLOB_HEADER');
    const header = raw.subarray(offset, lineEnd).toString();
    demand(header === row.blob + ' blob ' + row.bytes, 'BLOB_TYPE_SIZE');
    offset = lineEnd + 1;
    const body = raw.subarray(offset, offset + row.bytes);
    demand(body.length === row.bytes && hash(body) === row.sha256 && blobHash(body) === row.blob, 'STORED_BLOB_BYTES');
    for (const source of binding.files.filter(value => value.blob === row.blob && value.role === 'READONLY_PRODUCT_SOURCE_NOT_IMPORTED')) documents.set(source.commit + ':' + source.path, Buffer.from(body));
    offset += row.bytes;
    demand(raw[offset++] === 10, 'BLOB_TERMINATOR');
  }
  demand(offset === raw.length && documents.size === 343, 'NO_EXTRA_BLOB_BYTES');
  const oldCommit = '53eb5a53c9a02ad791abe52a6334adecb3b17325';
  const nextCommit = '8827ae258568d6fb9cf4fcafc26184a411110fbc';
  const finalCommit = 'f7439adfce6e38188cd97a63551b9e4887ccc759';
  const recipe = document(oldCommit, 'RECIPE-v4.json');
  const oldRows = document(oldCommit, 'capture-mode-v4/report/CASE-RESULTS.json').cases;
  const runs = [
    { commit: oldCommit, directory: 'capture-mode-v4', result: '000873' },
    { commit: nextCommit, directory: 'remaining-v5', result: '000168' },
    { commit: finalCommit, directory: 'clock-v7', result: '000518' }
  ].map(run => ({ ...run, data: document(run.commit, run.directory + '/actual-run/raw/' + run.result + '-FINAL-RESULT.json'), outer: document(run.commit, run.directory + '/actual-run/outer/FINAL.json'), archive: document(run.commit, run.directory + '/actual-run/EVIDENCE-MANIFEST.json'), cleanup: document(run.commit, run.directory + '/actual-run/CLEANUP.json') }));
  const expectedCandidate = binding.candidate;
  for (const run of runs) {
    demand(run.data.sourceCommit === expectedCandidate.source && run.data.derivedTree === expectedCandidate.derivedTree && run.data.packageSha256 === expectedCandidate.packageSha256 && run.data.source.selected === 282, 'SAME_CANDIDATE');
    demand(run.outer.coordinator.closed && run.outer.knownOutstanding.length === 0 && run.outer.result.active === 0 && run.cleanup.removedRootAbsent, 'HISTORICAL_RETIREMENT');
  }
  const manifests = ['semantic/CASES.json', 'mechanical-type-api-v2/CASES.json', 'semantic-integration-v2/CASES.json'].flatMap(name => document(oldCommit, name).cases);
  const byId = new Map(manifests.map(row => [row.id, row]));
  const planned = recipe.batches.flatMap(batch => batch.ids.map(id => ({ originalId: id, layout: batch.layout, originalBatch: batch.id, role: byId.get(id)?.role, rows: byId.get(id)?.rows ?? [] })));
  demand(planned.length === 274 && new Set(planned.map(row => key(row.layout, row.originalId))).size === 274, 'PLANNED274');
  const oldByKey = new Map(oldRows.map(row => [key(row.layout, row.id), row]));
  demand(oldByKey.size === 274, 'OLD274');
  const completed = runs.map(run => new Map(run.data.batches.flatMap(batch => batch.completed.map(row => [key(batch.layout, row.id), { ...row, batch: batch.batch, child: batch.child, run }]))));
  const originalDescriptors = document(oldCommit, 'semantic/CASE-DATA.json').cases;
  const replacements = document(nextCommit, 'remaining-v5/CASE-DATA.json').cases;
  const replacementMap = new Map();
  const replacementProofs = [];
  for (const row of replacements) {
    demand(row.id.endsWith('-via-tree-v1'), 'VERSIONED_REPLACEMENT_ID');
    const oldId = row.id.slice(0, -'-via-tree-v1'.length);
    const original = originalDescriptors.find(value => value.id === oldId);
    demand(original && JSON.stringify(original.spec.packs) === JSON.stringify(row.spec.packs) && JSON.stringify(original.expected) === JSON.stringify(row.expected), 'PACK_AND_EXPECTED_UNCHANGED');
    demand(original.spec.args[0] === 'show' && row.spec.args.length === 2 && row.spec.args[0] === 'show' && /^[a-f0-9]{40}:payload$/.test(row.spec.args[1]) && row.spec.extra.length === 2, 'SUPPORTED_QUERY_BINDING');
    replacementMap.set(oldId, row.id);
    replacementProofs.push({ originalId: oldId, replacementId: row.id, oldArgs: original.spec.args, newArgs: row.spec.args, expectedCanonicalSha256: hash(Buffer.from(JSON.stringify(row.expected))), unchangedPackDescriptorSha256: hash(Buffer.from(JSON.stringify(row.spec.packs))), wrapperPaths: row.spec.extra.map(value => value.path), priorWrapperProof: 'remaining-v5/PREPARATION-01/RESULT.json' });
  }
  demand(replacementMap.size === 13 && document(nextCommit, 'remaining-v5/PREPARATION-01/RESULT.json').result.wrapperCases === 13, 'REPLACEMENT13');
  const mappings = [];
  const used = new Set();
  for (const plannedRow of planned) {
    const old = oldByKey.get(key(plannedRow.layout, plannedRow.originalId));
    demand(old && old.role === plannedRow.role, 'ORIGINAL_ROLE');
    let candidate;
    let selection;
    if (old.status === 'PASS') { candidate = completed[0].get(key(old.layout, old.id)); selection = 'ORIGINAL_QUALIFIED214'; }
    else if (replacementMap.has(old.id)) { demand(old.status === 'FAIL' && old.role === 'STOCK', 'REPLACED_FAILURE_RETAINED'); candidate = completed[1].get(key(old.layout, replacementMap.get(old.id))); selection = 'VERSIONED_QUERY26'; }
    else if (old.id === 'T01' && old.layout === 'S') { candidate = completed[1].get(key(old.layout, old.id)); selection = 'T01_S_QUALIFIED'; }
    else { candidate = completed[2].get(key(old.layout, old.id)); selection = 'LATEST33'; }
    demand(candidate?.status === 'PASS' && candidate.child.closed && !candidate.child.timedOut, 'QUALIFIED_COMPLETION');
    const useKey = candidate.run.commit + ':' + key(old.layout, candidate.id);
    demand(!used.has(useKey), 'NO_REUSED_EVIDENCE'); used.add(useKey);
    const archiveRows = candidate.run.archive.files.filter(value => value.kind === 'file' && value.path.endsWith('-case-end.json') && value.path.includes('-' + candidate.batch + '-case-end.json'));
    const matching = archiveRows.map(row => ({ row, body: document(candidate.run.commit, candidate.run.directory + '/actual-run/' + row.path) })).filter(value => value.body.caseId === candidate.id);
    demand(matching.length === 1, 'EXACT_CASE_END');
    const { row, body } = matching[0];
    const caseBytes = documents.get(candidate.run.commit + ':' + prefix + candidate.run.directory + '/actual-run/' + row.path);
    demand(hash(caseBytes) === row.sha256 && caseBytes.length === row.bytes && row.mode === 0o600, 'ARCHIVED_CASE_END');
    demand(body.status === 'PASS' && !body.cleanupFailed && !body.escaped && !body.aborted && body.assertions.every(assertion => assertion.passed), 'CASE_ASSERTIONS');
    mappings.push({ ordinal: mappings.length + 1, ...plannedRow, originalStatus: old.status, originalCaseEnd: old.caseEnd ?? null, acceptedId: candidate.id, selection, acceptedStatus: 'PASS_QUALIFIED_SCOPE', evidenceCommit: candidate.run.commit, evidencePath: candidate.run.directory + '/actual-run/' + row.path, evidenceSha256: row.sha256, acceptedBatch: candidate.batch, batchExit: candidate.child.code, assertions: body.assertions.length, rawCapture: body.captureReference, priorTupleRescored: false });
  }
  const roles = countBy(mappings, 'role');
  const selections = countBy(mappings, 'selection');
  demand(roles.STOCK === 208 && roles.MECHANICAL === 32 && roles.TYPE === 10 && roles.LOADED === 24, 'EXACT_ROLES');
  demand(selections.ORIGINAL_QUALIFIED214 === 214 && selections.VERSIONED_QUERY26 === 26 && selections.T01_S_QUALIFIED === 1 && selections.LATEST33 === 33, 'EXACT_COMPOSITION');
  demand(mappings.filter(row => row.role === 'MECHANICAL' && row.originalId.startsWith('S01')).length === 18 && mappings.filter(row => row.role === 'LOADED' && row.originalId.startsWith('S01')).length === 3, 'S01_ROLES_SEPARATE');
  const format = document(oldCommit, 'semantic/COVERAGE.json');
  const resources = document(oldCommit, 'mechanical/RESOURCE-MAP.json');
  demand(format.rows.length === 38 && format.families.length === 12 && format.workflows.length === 6 && resources.resource.length === 32 && resources.resource.flatMap(row => row.variants).length === 108, 'FINITE_MAPS');
  const coverage = { formatRows: format.rows.map(row => ({ id: row.id, family: row.family, originalCaseIds: row.selectedCaseIds, mappedIdentities: mappings.filter(value => row.selectedCaseIds.includes(value.originalId)).map(value => value.layout + ':' + value.acceptedId), remaining: row.remainingSourceOnlyOrUnrun, completeDynamicClosure: false })), resourceRows: resources.resource, resourceVariantsAreNotPassCount: true, families: format.families.map(row => ({ ...row, status: 'MAPPED_NOT_EXHAUSTIVE_DYNAMIC_PROOF' })), workflows: format.workflows.map(row => ({ ...row, status: 'FINITE_VIRTUAL_CASE_MAPPINGS', nativeOracle: 'UNRUN', mappedIdentities: mappings.filter(value => row.caseIds.includes(value.originalId)).map(value => value.layout + ':' + value.acceptedId) })) };
  const historyOnly = document(finalCommit, 'verification-v6/actual-run/raw/000070-T01-M-case-end.json');
  demand(historyOnly.status === 'PASS' && historyOnly.assertions.length === 3 && !mappings.some(row => row.evidencePath.startsWith('verification-v6/')), 'RAW_BODY_HISTORY_NOT_SELECTED');
  await publish('MAPPING-274.json', { schema: 'm1b-module-acceptance-274-bijection-v1', role: 'SOURCE_DATA_SELECTION_OF_PREVIOUSLY_QUALIFIED_RESULTS_NOT_NEW_RUNTIME', originalRecipeSha256: hash(documents.get(oldCommit + ':' + prefix + 'RECIPE-v4.json')), mappings, replacementProofs });
  await publish('COVERAGE-MAPS.json', coverage);
  const table = ['# Exact274 identity selection', '', 'SOURCE/DATA composition, not a replay or an original274 all-pass rescore.', '', '| # | Original identity | Role | Original status | Selected identity | Evidence cohort |', '| --- | --- | --- | --- | --- | --- |', ...mappings.map(row => '| ' + row.ordinal + ' | ' + row.layout + ':' + row.originalId + ' | ' + row.role + ' | ' + row.originalStatus + ' | ' + row.layout + ':' + row.acceptedId + ' | ' + row.evidenceCommit.slice(0, 8) + ' |')].join('\n') + '\n';
  await publish('TABLE-274.md', Buffer.from(table), true);
  for (const row of binding.files) if (row.role !== 'READONLY_PRODUCT_SOURCE_NOT_IMPORTED') await regular(row);
  summary = { disposition: 'COMPLETE_274_IDENTITY_MAPPING_SOURCE_DATA_ONLY', roles, selections, layouts: countBy(mappings, 'layout'), mapped: mappings.length, uniqueEvidenceSelections: used.size, sourceInputsAuthenticated: binding.files.length, uniqueStoredBlobs: unique.size, formatRows: 38, resourceRows: 32, resourceVariants: 108, formatFamilies: 12, virtualWorkflowMappings: 6, nativeOraclesUnrun: 6, newProductExecutions: 0, publicDefaultAcceptance: false, oldFailedTuplesRescored: 0, oldBodyOnlyReceiptsSelected: 0 };
} catch (error) { failure = { name: error?.name ?? typeof error, message: error?.message ?? String(error) }; process.exitCode = 1; }
finally { await publish('RESULT.json', { summary, failure, metadataChildren: children, metadataRetired: receipts.every(row => row.status === 0 && row.signal === null && row.error === null), elapsedMs: performance.now() - started, captureBytesBeforeResult: written, receipts, noRetry: true }); }
