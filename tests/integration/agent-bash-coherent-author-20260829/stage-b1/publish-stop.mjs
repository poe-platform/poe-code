import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
const scope = import.meta.dirname;
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const files = [];
let capturedBytes = 0;
try {
  const evidence = path.join(scope, 'evidence'); fs.mkdirSync(evidence);
  for (const label of ['initial','read02','read03','read04','read05','read06','read07','read08','data','data-v2','author','workers-source','seal']) {
    for (const suffix of ['stdout','stderr']) {
      const source = `/private/tmp/coherent-b1-prep-20260829-${label}.${suffix}`;
      const stat = fs.lstatSync(source);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 16777216) throw new Error('Raw capture admission');
      capturedBytes += stat.size; if (capturedBytes > 67108864) throw new Error('Raw capture aggregate');
      const bytes = fs.readFileSync(source);
      if (bytes.length !== stat.size) throw new Error('Capture read size');
      const target = path.join(evidence, path.basename(source)); fs.writeFileSync(target, bytes, { flag: 'wx' });
      files.push({ path: path.relative(scope, target), bytes: bytes.length, sha256: digest(bytes) });
    }
  }
  const now = new Date();
  const result = {
    status: 'STOP_MISSING_ADMISSION_HELPER_NO_EXECUTABLE_PRESEAL', at: now.toISOString(),
    conservativeGrantAnchor: '2026-08-29T12:10:00.000Z', elapsedFromConservativeAnchorSeconds: (now.getTime() - Date.parse('2026-08-29T12:10:00.000Z')) / 1000,
    latestSourceHelperExit: 78,
    exactMissingPath: 'tests/integration/agent-bash-coherent-author-20260829/stage-b/admission.mjs',
    boundary: 'lstat failed in seal.mjs staging descriptor; no helper contents read, no alternate locator selected',
    presealExists: fs.existsSync(path.join(scope, 'PRESEAL.json')),
    controlsExecuted: 0, harmlessControllerStarts: 0, productImports: 0, guestEngineImports: 0, compilerRuns: 0, installs: 0, workers: 0,
    completeDataAuthentication: { publicReceipt: 'a4d3614d6d944660aaddc1fd95c8fe6ebef1d92fc0dd8607400578d9a82254de', engineEntries: 96, engineEmissions: 95, metadata: 1, source98Records: 98, retainedHelperRecords: 14, privateReads: 0 },
    semanticArithmetic: { B0AuthorObserved: 39, B1PublicPlanned: 15, retainedCorePlanned: 636, N14Planned: 36, B2RetainedPlanned: 672, totalPlanned: 726, exactExpandedB2Ids: 'NOT_YET_COMPLETE', unit2PerLayout: 50 },
    knownStartAccounting: { instructionContext: 1, initialAdmission: 6, read02: 2, read03: 2, read04: 3, read05: 3, read06: 2, read07: 2, read08: 2, firstSyntaxCheck: 3, readFirstFailure: 1, correctedDataAuthenticationIncludingGit: 6, sourceSyntaxChecks: 5, workerSourceRead: 1, attemptedSeal: 4, readSealFailure: 1, finalPublicationIncludingTwoCommitsAndIdentities: 9, inclusiveConservativeStarts: 53, limit: 56, qualification: 'Known explicit OS/admin/helper invocations, not OS-wide descendant census. Final publication command transcript records its completion.' },
    capturedBytesBeforePublication: capturedBytes,
    retirement: 'All preceding tool sessions returned; two synchronous metadata children had status0/signalnull; no product/Worker child started. No whole-transitive or process-group census claim.',
    blockers: [
      'Resolve and authenticate the staged admission helper origin from an existing authority; do not assume the relative consumer import denotes a repository source locator.',
      'Complete executable preseal after that source mapping is reviewed; proposed 15PURE controls remain unexecuted and are not credited.',
      'Different preexecution review and fresh actual authorization/window remain required for B1.',
      'B2 exact expanded identity maps/type consumers/loaded mutations-restores/negative bindings remain incomplete; all672 retained rows are still mandatory.'
    ],
    oldEvidencePreserved: ['B0 d116d79a author39P, independent audit pending', 'all prior StageA/B0 failures', 'captured DATA syntax error corrected before any DATA execution'],
  };
  fs.writeFileSync(path.join(evidence, 'STOP.json'), JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
  const walk = (directory, prefix = '') => {
    for (const name of fs.readdirSync(directory).sort()) {
      const file = path.join(directory, name), relative = prefix ? `${prefix}/${name}` : name;
      const stat = fs.lstatSync(file);
      if (name === 'AGENTS.md') throw new Error('Instruction copy refused');
      if (stat.isDirectory()) walk(file, relative);
      else {
        if (!stat.isFile() || stat.size > 8388608) throw new Error('Publication input admission');
        const bytes = fs.readFileSync(file); files.push({ path: relative, bytes: bytes.length, sha256: digest(bytes) });
      }
    }
  };
  walk(scope);
  const unique = [...new Map(files.map(entry => [entry.path, entry])).values()];
  const totalBytes = unique.reduce((sum, entry) => sum + entry.bytes, 0);
  if (totalBytes > 536870912) throw new Error('Preparation working cap');
  fs.writeFileSync(path.join(evidence, 'MANIFEST.json'), JSON.stringify({ at: new Date().toISOString(), totalBytes, files: unique }, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify(result));
  console.log('EVIDENCE', JSON.stringify({ files: unique.length, totalBytes, sha256: digest(fs.readFileSync(path.join(evidence, 'MANIFEST.json'))) }));
} catch (error) { console.error(error); process.exitCode = 78; }
