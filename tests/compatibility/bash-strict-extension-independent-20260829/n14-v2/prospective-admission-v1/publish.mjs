import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';

const repo = '/Users/kjopek/Workspace/safe-bash';
const scope = 'tests/compatibility/bash-strict-extension-independent-20260829/n14-v2/prospective-admission-v1';
const directory = path.join(repo, scope);
const publication = fs.mkdtempSync(path.join(os.tmpdir(), 'strict-n14-prospective-publication-'));
const stdout = fs.openSync(path.join(publication, 'stdout.raw'), 'wx');
const stderr = fs.openSync(path.join(publication, 'stderr.raw'), 'wx');
const eventFile = fs.openSync(path.join(publication, 'events.jsonl'), 'wx');
const emit = value => fs.writeSync(eventFile, JSON.stringify({ at: Date.now(), ...value }) + '\n');
emit({ event: 'capture-open', pid: process.pid });
const children = [];
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const gitConfig = ['-c', 'gc.auto=0', '-c', 'maintenance.auto=false', '-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', '-c', 'core.abbrev=40'];
function run(executable, args, input) {
  const child = spawnSync(executable, args, { cwd: repo, input, encoding: 'utf8', timeout: 30000, maxBuffer: 2 * 1024 * 1024 });
  children.push({ pid: child.pid, executable, args, status: child.status, signal: child.signal, error: child.error ? String(child.error) : null });
  fs.writeSync(stdout, child.stdout ?? ''); fs.writeSync(stderr, child.stderr ?? '');
  emit({ event: 'child-closed', ...children.at(-1) });
  assert.equal(child.error, undefined); assert.equal(child.signal, null); assert.equal(child.status, 0);
  return child.stdout;
}
try {
  const start = JSON.parse(fs.readFileSync(path.join(directory, 'prep/START.json')));
  assert.ok(Date.now() - start.firstCaptureMs < 1500000, 'root deadline');
  const sealBytes = fs.readFileSync(path.join(directory, 'PRESEAL.json'));
  assert.equal(hash(sealBytes), 'c0378c0d2a7325096f69643445fa3bdeaa92876a74da78dffd91de4aa75f0a80');
  const seal = JSON.parse(sealBytes);
  for (const [name, authority] of Object.entries(seal.files)) assert.equal(hash(fs.readFileSync(path.join(directory, name))), authority.sha256);
  const result = JSON.parse(fs.readFileSync(path.join(directory, 'actual-v1/work/RESULT.json')));
  const outer = JSON.parse(fs.readFileSync(path.join(directory, 'actual-v1/OUTER.json')));
  assert.equal(result.controls.length, 12); assert.ok(result.controls.every(control => control.status === 'PASS'));
  assert.equal(result.artifact.status, 'PASS'); assert.equal(result.artifact.result.members, 954);
  assert.equal(outer.primaryPresent, false); assert.equal(outer.result.code, 0); assert.equal(outer.result.signal, null);
  const stagedBefore = run('/usr/bin/git', [...gitConfig, 'diff', '--cached', '--name-status', '-z']);
  fs.writeFileSync(path.join(publication, 'foreign-staging-before.raw'), stagedBefore, { flag: 'wx' });
  const census = {
    rootCap: { seconds: 1500, knownOS: 48, peak: 3, captureBytes: 67108864, workBytes: 268435456 },
    actual: { outerPid: outer.pid, childPid: outer.childPid, processes: 2, peak: 2, exit: outer.result, rawChildBytes: outer.captureBytes, decoder: 1, parser: 1, extraction: 0, productImports: 0, workers: 0, nativeCommands: 0 },
    conservativeRoleAccounting: [
      ['initial data capture and Git status', 2], ['instruction-free clock/artifact metadata read', 1],
      ['first shell/apply_patch/interpreter slots', 3], ['captured manifest metadata helper', 1],
      ['second shell/apply_patch/interpreter slots', 3],
      ['combined edit/preparation: hosting PID, patch roles, 9 recorded children, 2 subordinate interpreter slots', 14],
      ['preseal administrator plus Git add/commit', 3], ['actual outer and child', 2], ['captured postguard helper', 1],
      ['publication-source edit shell/patch/interpreter slots', 3],
      ['publication administrator, five Git operations, patch/interpreter slots', 8],
    ],
    conservativeTotalIncludingPublication: 41,
    remainingUnspentSlots: 7,
    qualification: 'Conservative explicit launch-role accounting, including possible apply_patch interpreter slots; NOT an exact measured transitive process census. Actual proof has two observed processes, child exit+close, outer tool exit. Administrative children are synchronous with recorded status/signal. No Worker or native-resource lifetime inference.',
    publicationCapture: publication,
    captureQualification: 'Correction runtime has stable exclusive file capture before admission. Source edits and the instruction-free initial clock/artifact read also have tool-transcript records, not an invented all-preparation file-capture guarantee. No instruction text copied.',
  };
  const report = `# Prospective package admission proof\n\nDate: 2026-08-29. Scoped prospective PASS; ROOT acceptance is not published.\n\n## Frozen bindings\n\n- Pre-execution commit: 9cbb83c9d3491cd38cb8db818adb9f319d52d57a.\n- Executable preseal SHA256: ${hash(sealBytes)}.\n- Corrected gate SHA256: ${seal.files['package-admission.mjs'].sha256}.\n- Retained archive: ${JSON.parse(fs.readFileSync(path.join(directory, 'ARTIFACT.json'))).path}.\n- Archive exact length 872281; SHA256 3f3ae85116f12ab4354a6103c0c95e967c4e88bd2eb133e63236148a2734af49.\n- Prior manifest chain 026c4a76cd442793276730ca83bafdfcf74e4779138e754537308fc3b8a09b39 -> c471ecf8d9582fb7fed677ef25e734b51ab8f988a9e55a2c853489016cbdcabb -> RESULT c031715228f24c4bd48a231a87668f153ff7cf1ee2882fde7ac90ed372267a3a. Expected 954 member identities are copied as DATA, not regenerated from this parse.\n\n## Actual finite results\n\n12/12 controls PASS, one real retained-artifact admission/inflate/parse PASS. C01–C10 and C12 refuse with zero decoder/parser/extraction calls. C11 actually loads the sealed ordering mutant: its deliberately premature SPY decoder call is observed once and kills the ordering invariant; no real inflation occurs there. C12 loads the byte-identical restored gate and refuses with zero calls. The real artifact makes exactly one gunzip and one parser call, zero extraction/import/evaluation.\n\nAll 954 members match expected literal path, mode, length and SHA256; tar header checksum/regular type/end bounds also checked. Payload 4821648 bytes; decoded tar 5545984 bytes. Nothing extracted, no shipping module/consumer evaluated. No product/build/compiler/npm/native/Worker/network/private execution. Seven source-only node --check children are syntax checks, not compiler/product runs.\n\n## Admission order and bounds\n\npackage-admission.mjs:28 checks regular lstat/type/exact size before open; :40 opens O_NOFOLLOW and fstat-binds identity; :43 reserves before :45 allocation. Reads are capped at 64KiB into one exact-size Buffer plus one EOF probe. Post-read fstat/lstat mutation checks precede :60 exact SHA rejection. Descriptor closes before :77 concurrent-buffer reservation and :80 decode. :83 parses that decoder output. There is no archive pathname reread between authentication and inflation.\n\nObserved event sequence: lstat-type-size -> bounded-read -> postread-identity -> exact-hash -> descriptor-closed -> concurrent-buffers-reserved -> decoded -> parsed. Compressed ceiling 872281; decoded ceiling 67108864; compressed+probe+decoded ceiling+2MiB logical parser reservation peak 70078298, released to zero. C10 independently refuses insufficient concurrent capacity before decoding. Whole compressed and bounded decoded Buffers are used; this is NOT streaming inflation or exact RSS/native zlib-allocation accounting.\n\nMetadata checks do not claim race-proof filesystem isolation from a malicious concurrent host. The exact SHA and same admitted Buffer bind the bytes actually decoded. The harness is a finite trusted code route, not a new universal OS sandbox. Untested descriptor-close failures, tar dialects, or arbitrary decompression bombs receive no new qualification.\n\n## Capture, retirement, and preservation\n\nOuter PID ${outer.pid}, child PID ${outer.childPid}; natural child exit0/signal-null followed by close0/signal-null, outer exit0. Raw stdout ${outer.captureBytes} bytes, stderr0. No timeout or termination signal, no outstanding owned fixtures (work contains only RESULT.json). Sealed source postguards and retained archive regular/type/size/hash match. Direct actual peak2; all grant/admin accounting and conservative qualifications are in CENSUS.json. Publication raw files are intentionally retained at ${publication}; commit receipt is not recursively embedded in its own commit.\n\nNo correction runtime retried. Earlier source-only parser prefix mapping was reconciled before preseal/execution against the captured expected manifest. Source edits/tool metadata reads are not presented as a complete all-process OS telemetry trace.\n\nThe original c6992dfa admission-order finding and CLOSED/noncompliant attempt remain unchanged. Its 744 literal results are NOT rescored, rerun, or made contemporaneously compliant by this new proof. This prospective gate is in a new namespace; the old runner was not modified. The result supplies prospective correction evidence for ROOT's separate finite semantic/source adjudication; coherent end-to-end validation still requires contemporaneously compliant admission in any future authorized run. No automatic rerun or ROOT acceptance is asserted.\n`;
  const dataFiles = [['REPORT.md', report], ['CENSUS.json', JSON.stringify(census, null, 2) + '\n']];
  const patch = '*** Begin Patch\n' + dataFiles.map(([name, text]) => '*** Add File: ' + path.join(directory, name) + '\n' + text.trimEnd().split('\n').map(line => '+' + line).join('\n') + '\n').join('') + '*** End Patch\n';
  run('/Users/kjopek/.codex/tmp/arg0/codex-arg0wITElD/apply_patch', [], patch);
  const inventory = [];
  function visit(relative = '') {
    for (const name of fs.readdirSync(path.join(directory, relative))) {
      const child = path.posix.join(relative, name);
      const filename = path.join(directory, child);
      const stat = fs.lstatSync(filename);
      if (stat.isDirectory()) visit(child);
      else { assert.ok(stat.isFile()); const bytes = fs.readFileSync(filename); inventory.push({ path: child, mode: stat.mode & 0o777, bytes: bytes.length, sha256: hash(bytes) }); }
    }
  }
  visit();
  inventory.sort((first, second) => Buffer.compare(Buffer.from(first.path), Buffer.from(second.path)));
  const manifest = JSON.stringify({ ordering: 'flat relative UTF-8 path byte lexicographic; regular mode/length/SHA256; manifest excludes itself', files: inventory, preseal: hash(sealBytes), controls: 12, actualArtifacts: 1, old744Rescored: false, qualification: 'Prospective only' }, null, 2) + '\n';
  fs.writeFileSync(path.join(directory, 'EVIDENCE-MANIFEST.json'), manifest, { flag: 'wx' });
  run('/usr/bin/git', [...gitConfig, 'add', '--', scope]);
  const commit = run('/usr/bin/git', [...gitConfig, 'commit', '--only', '-m', 'test: prove prospective hash-before-inflate package admission', '--', scope]);
  const stagedAfter = run('/usr/bin/git', [...gitConfig, 'diff', '--cached', '--name-status', '-z']);
  assert.equal(stagedAfter, stagedBefore, 'foreign staging changed');
  const status = run('/usr/bin/git', [...gitConfig, 'status', '--porcelain=v1', '--untracked-files=all', '--', scope]);
  assert.equal(status, '', 'owned scope not clean');
  const receipt = { commit, evidenceManifestSha256: hash(manifest), files: inventory.length + 1, elapsedSeconds: (Date.now() - start.firstCaptureMs) / 1000, children, foreignStagingPreserved: true, ownedClean: true, publication };
  fs.writeFileSync(path.join(publication, 'RECEIPT.json'), JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx' });
  process.stdout.write(JSON.stringify(receipt, null, 2) + '\n');
} catch (reason) {
  fs.writeSync(stderr, String(reason?.stack ?? reason) + '\n');
  emit({ event: 'primary', reasonPresent: true, reason: String(reason?.stack ?? reason) });
  process.exitCode = 1;
} finally {
  emit({ event: 'capture-closure', children });
  fs.closeSync(stdout); fs.closeSync(stderr); fs.closeSync(eventFile);
}
