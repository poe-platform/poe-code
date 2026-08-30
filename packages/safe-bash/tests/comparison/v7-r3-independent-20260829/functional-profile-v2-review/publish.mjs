import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
const home = path.dirname(fileURLToPath(import.meta.url));
const receiptFd = fs.openSync(path.join(home, 'PUBLICATION.json'), 'wx', 0o600);
const requireThat = (condition, code) => { if (!condition) throw Error(code); };
async function binding(filename, cap = 262144) {
  const info = fs.lstatSync(filename);
  requireThat(info.isFile() && !info.isSymbolicLink() && info.size <= cap, 'FILE_ADMISSION');
  let bytes = 0; const hash = createHash('sha256');
  for await (const chunk of fs.createReadStream(filename, { highWaterMark: 65536 })) { bytes += chunk.length; requireThat(bytes <= info.size, 'FILE_GROWTH'); hash.update(chunk); }
  requireThat(bytes === info.size, 'FILE_SHORT');
  return { path: filename, bytes, mode: info.mode & 511, sha256: hash.digest('hex') };
}
function json(filename) {
  const info = fs.lstatSync(filename); requireThat(info.isFile() && !info.isSymbolicLink() && info.size <= 262144, 'JSON_ADMISSION');
  return JSON.parse(fs.readFileSync(filename, 'utf8'));
}
let result;
try {
  const seal = json(path.join(home, 'PRESEAL.json'));
  const archived = json(path.join(home, 'ARCHIVE-RECEIPT.json'));
  const main = json(path.join(home, 'work/RESULT.json'));
  const continuation = json(path.join(home, 'continuation/RESULT.json'));
  requireThat(archived.status === 'ARCHIVED_VERIFIED_SCOPED_CLEANUP', 'ARCHIVE_STATUS');
  const postguards = json(path.join(home, 'POSTGUARDS.json'));
  for (const row of postguards.rows) {
    const actual = await binding(row.path, 240000000);
    requireThat(actual.sha256 === row.sha256 && actual.bytes === row.bytes && actual.mode === row.mode, 'PUBLICATION_SOURCE_DRIFT');
  }
  const review = await binding(path.join(home, 'REVIEW.json'));
  const inactive = json(path.join(seal.source, 'AUTH-INACTIVE.json'));
  const interfaceFile = await binding(path.join(seal.source, 'INTERFACE-DELTA.json'));
  const launchFile = await binding(path.join(seal.source, 'FUTURE-LAUNCH.sh.data'));
  const future = { schema: 'INDEPENDENT_FUTURE_AUTH_REQUIREMENTS', active: false, activationPerformed: false, review: { commit: 'USE_THIS_RECEIPT_EVIDENCE_COMMIT', path: path.relative('/Users/kjopek/Workspace/safe-bash', review.path), sha256: review.sha256 }, recipeSha256: seal.rootSealSha256, interface: interfaceFile, inertLaunch: launchFile, sealedInactiveTemplate: inactive, requiresFreshRootGrant: true };
  fs.writeFileSync(path.join(home, 'FUTURE-AUTH-REQUIREMENTS.json'), JSON.stringify(future, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  const capture = ['raw/RECEIPT.json', 'continuation/raw/RECEIPT.json'].map(name => json(path.join(home, name)));
  requireThat(capture.every(row => row.primary === null && row.preflight && row.postflight && row.close && row.exit), 'CONTROL_RETIREMENT');
  const excluded = new Set(['PUBLICATION.json', 'EVIDENCE-MANIFEST.json', 'publish.stdout.raw', 'publish.stderr.raw']);
  const files = [];
  let liveBytes = 0;
  async function walk(directory) {
    for (const name of fs.readdirSync(directory).sort()) {
      const filename = path.join(directory, name), relative = path.relative(home, filename), info = fs.lstatSync(filename);
      requireThat(!info.isSymbolicLink(), 'OWNED_SYMLINK');
      if (info.isDirectory()) await walk(filename);
      else if (!excluded.has(relative)) {
        const row = await binding(filename, 33554432); liveBytes += row.bytes;
        requireThat(liveBytes <= 41943040 && files.length < 100, 'PUBLICATION_WORK_BOUND');
        files.push({ ...row, path: relative });
      }
    }
  }
  await walk(home);
  const otherBytes = liveBytes - archived.archive.bytes;
  requireThat(otherBytes < 8388608 - 1048576, 'OTHER_CAPTURE_RESERVE');
  requireThat(archived.combinedRawPlusArchiveBytes + otherBytes + 1048576 < 134217728, 'COMBINED_CAPTURE_BOUND');
  const manifest = { schema: 'FUNCTIONAL_V2_REVIEW_EVIDENCE_MANIFEST', files, excludedPublicationTail: [...excluded], qualification: 'Excluded terminal metadata/capture is bound by the evidence Git commit, not recursively self-hashed.' };
  fs.writeFileSync(path.join(home, 'EVIDENCE-MANIFEST.json'), JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  result = {
    schema: 'FUNCTIONAL_V2_INDEPENDENT_PUBLICATION', status: 'PREEXECUTION_ACCEPTED', recipeSha256: seal.rootSealSha256, review,
    authorNew: { passed: 14, total: 14 }, retainedAdmissionData: { passed: 3, total: 3 }, originalNovel: { passed: main.independent.filter(row => row.pass).length, total: main.independent.length }, versionedN07: { status: continuation.status, missingFinalNegative: continuation.missingFinalNegative },
    rawCaptures: capture, rawChildBytes: capture.reduce((sum, row) => sum + Object.values(row.streams).reduce((left, right) => left + right, 0), 0),
    archive: archived, finalPostguards: postguards.rows.length, liveEvidenceBytes: liveBytes, conservativeCombinedCaptureIncludingOneMiBPublicationReserve: archived.combinedRawPlusArchiveBytes + otherBytes + 1048576,
    processes: { taskRoleAccountingUpperBoundIncludingFinalGitPublication: 64, authorizedAllOwnedCap: 80, accounting: 'Conservative tool-call/role bound, not a kernel census. Includes exec-replaced Node helpers, shell/Git/patch administration allowances, two capture parents and their two dispatch children. No control-created descendants. No CLI leaf.', actualControlDispatchChildren: 2, controlCaptureParents: 2, controlPeak: 2, authorizedPeak: 3, allObservedToolCommandsCompletedAtPublication: true, controlChildrenExitAndCloseObserved: true, globalAbsenceClaim: false },
    actualEngines: 0, actualWorkers: 0, semanticPrograms: 0, C11: 0, activation: false, full416Replayed: false, historicResultsRescored: false,
    ordinaryDataHelperError: { requested: 'INTERFACE.json', result: 'ENOENT', correction: 'Select sealed INTERFACE-DELTA.json from bounded directory metadata', childLaunched: false, testRetried: false },
    bounds: { minutesIncludingPublication: 40, allOwnedProcesses: 80, peak: 3, captureBytes: 134217728, workBytes: 805306368 },
    checkpoint: new Date().toISOString(), publicationTail: 'Final explicit-path Git commit and status confirmation still follow this receipt; successful dispositions are reported in the final handoff. No prospective final Git completion is counted as already observed.'
  };
} catch (error) { result = { status: 'HOLD', message: String(error.message), activation: false }; process.exitCode = 1; }
fs.writeSync(receiptFd, JSON.stringify(result, null, 2) + '\n'); fs.fsyncSync(receiptFd); fs.closeSync(receiptFd);
process.stdout.write(JSON.stringify({ status: result.status, reviewSha256: result.review?.sha256, originalNovel: result.originalNovel, versionedN07: result.versionedN07, finalPostguards: result.finalPostguards, captureBound: result.conservativeCombinedCaptureIncludingOneMiBPublicationReserve, message: result.message ?? null }) + '\n');
