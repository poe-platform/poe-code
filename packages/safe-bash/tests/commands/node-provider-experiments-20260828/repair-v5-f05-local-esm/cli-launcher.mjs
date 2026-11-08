import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { gzipSync, gunzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';

export async function launch(executionCommit, expectedSeal, grantSha256, activationToken) {
  const started = Date.now();
  const deadline = started + 300000;
  const ownedRoot = '/Users/kjopek/Workspace/safe-bash/tests/commands/node-provider-experiments-20260828/repair-v5-f05-local-esm';
  const owner = { handle: null, closeObserved: false, evidenceCreated: false, archiveAuthenticated: false, admissionOpen: true, unsafe: false };
  const lifecycle = ['owner-enrolled-before-helpers'];
  const signals = [], secondary = [], stdout = [], stderr = [];
  let primaryPresent = false, primaryReason, closeResolve, closeReject, cleanupCompletion;
  let grace, forced, seal, result, outputSnapshot, finalSnapshot, archiveBinding;
  let stdoutBytes = 0, stderrBytes = 0, retainedBytes = 0, captureBytes = 0;
  const closeWait = new Promise((resolve, reject) => { closeResolve = resolve; closeReject = reject; });
  void closeWait.catch(() => {});
  const remember = reason => { if (!primaryPresent) { primaryPresent = true; primaryReason = reason; } else secondary.push(reason); };
  const shape = reason => { try { return { type: reason === null ? 'null' : typeof reason, name: reason?.name ?? null, code: reason?.code ?? null, message: String(reason?.message ?? reason), stack: typeof reason?.stack === 'string' ? reason.stack : null }; } catch { return { type: 'unserializable' }; } };
  const send = signal => { signals.push(signal); try { owner.handle.kill(signal); } catch (reason) { remember(reason); } };
  const contain = reason => {
    remember(reason);
    owner.admissionOpen = false;
    if (!owner.handle || owner.closeObserved || signals.length) return;
    send('SIGTERM');
    grace = setTimeout(() => {
      if (owner.closeObserved) return;
      send('SIGKILL');
      forced = setTimeout(() => { if (!owner.closeObserved) { owner.unsafe = true; closeReject(new Error('CONTROLLER_CLOSE_UNCERTAIN')); } }, 1000);
    }, 1000);
  };
  const deadlineTimer = setTimeout(() => contain(new Error('LAUNCH_CLEANUP_RESERVE')), 270000);
  lifecycle.push('pre-acquisition-deadline-armed');
  const sha = bytes => createHash('sha256').update(bytes).digest('hex');
  const encode = value => Buffer.from(JSON.stringify(value) + '\n');
  const checkTime = () => assert.ok(Date.now() < deadline, 'OVERALL_WITH_CLEANUP_BOUND');
  function canonical(absolute) {
    let cursor = '/';
    for (const part of absolute.split('/').filter(Boolean)) {
      cursor = path.join(cursor, part);
      const stat = fs.lstatSync(cursor);
      assert.ok(!stat.isSymbolicLink(), 'SYMLINK:' + cursor);
      assert.equal(fs.realpathSync(cursor), cursor, 'ALIAS:' + cursor);
    }
    return fs.lstatSync(absolute);
  }
  function tree(directory) {
    const files = {}, directories = [];
    let bytes = 0, entries = 0;
    function visit(prefix) {
      for (const name of fs.readdirSync(path.join(directory, prefix)).sort()) {
        const relative = prefix ? prefix + '/' + name : name;
        assert.ok(!relative.includes('..') && !relative.includes('\\'));
        assert.ok(++entries <= 256);
        const absolute = path.join(directory, relative), stat = fs.lstatSync(absolute);
        assert.ok(!stat.isSymbolicLink()); assert.equal(fs.realpathSync(absolute), absolute);
        if (stat.isDirectory()) { directories.push(relative + '/'); visit(relative); }
        else {
          assert.ok(stat.isFile() && stat.nlink === 1, 'REGULAR_SINGLE_LINK');
          bytes += stat.size; assert.ok(bytes <= 67108864);
          files[relative] = { bytes: stat.size, mode: stat.mode & 511, sha256: sha(fs.readFileSync(absolute)) };
        }
      }
    }
    canonical(directory); visit(''); return { files, directories, entries, bytes };
  }
  function immutable() {
    const current = tree(ownedRoot);
    const actual = Object.keys(current.files).filter(name => !name.startsWith('activation/') && name !== 'ROOT-GO.json').sort();
    assert.deepEqual(actual, [...seal.files.map(row => row.path), 'PRESEAL.json'].sort(), 'IMMUTABLE_MEMBERSHIP');
    for (const row of seal.files) { assert.equal(current.files[row.path].sha256, row.sha256, row.path); assert.equal(current.files[row.path].bytes, row.bytes); }
    assert.equal(current.files['PRESEAL.json'].sha256, expectedSeal);
    const expectedDirectories = new Set();
    for (const row of [...seal.files, { path: 'PRESEAL.json' }]) {
      const parts = row.path.split('/'); parts.pop();
      while (parts.length) { expectedDirectories.add(parts.join('/') + '/'); parts.pop(); }
    }
    assert.deepEqual(current.directories.filter(name => !name.startsWith('activation/') && name !== 'ROOT-GO.json').sort(), [...expectedDirectories].sort(), 'IMMUTABLE_DIRECTORY_MEMBERSHIP');
    assert.equal(sha(fs.readFileSync(path.join(ownedRoot, 'ROOT-GO.json'))), grantSha256, 'IMMUTABLE_ROOT_GRANT');
    const controllerTree = tree(seal.paths.inputRoot);
    assert.deepEqual(Object.keys(controllerTree.files).filter(name => !name.startsWith('runs/')).sort(), seal.controllerInputFiles.map(row => row.path).sort(), 'V4_INPUT_MEMBERSHIP');
    for (const row of seal.controllerInputFiles) { assert.equal(controllerTree.files[row.path].sha256, row.sha256, row.path); assert.equal(controllerTree.files[row.path].bytes, row.bytes); }
    const inputDirectories = new Set();
    for (const row of seal.controllerInputFiles) { const parts = row.path.split('/'); parts.pop(); while (parts.length) { inputDirectories.add(parts.join('/') + '/'); parts.pop(); } }
    assert.deepEqual(controllerTree.directories.filter(name => !name.startsWith('runs/')).sort(), [...inputDirectories].sort(), 'V4_INPUT_DIRECTORY_MEMBERSHIP');
    assert.ok(controllerTree.directories.filter(name => name.startsWith('runs/')).every(name => ['runs/', 'runs/f05-admission-01/'].includes(name)));
    assert.ok(Object.keys(controllerTree.files).filter(name => name.startsWith('runs/')).every(name => name.startsWith('runs/f05-admission-01/')));
    assert.ok(current.bytes + controllerTree.bytes <= 67108864, 'COMBINED_WORK_BOUND');
    return current;
  }
  function save(name, bytes) {
    checkTime(); assert.ok(owner.evidenceCreated && !name.includes('/'));
    const body = Buffer.isBuffer(bytes) ? bytes : encode(bytes);
    captureBytes += body.length; assert.ok(captureBytes <= 16777216);
    const destination = path.join(seal.paths.evidenceRoot, name);
    fs.writeFileSync(destination, body, { flag: 'wx', mode: 0o600 });
    assert.equal(sha(fs.readFileSync(destination)), sha(body));
  }
  function cleanup() {
    if (cleanupCompletion) return cleanupCompletion;
    owner.admissionOpen = false;
    cleanupCompletion = (async () => {
      if (owner.handle && !owner.closeObserved) { contain(primaryPresent ? primaryReason : new Error('OUTER_RETIREMENT')); await closeWait; }
      if (owner.handle && !owner.closeObserved) throw new Error('NO_CLEANUP_WITHOUT_CLOSE');
      if (owner.archiveAuthenticated && outputSnapshot) {
        checkTime(); immutable();
        assert.deepEqual(tree(seal.paths.runOutput), outputSnapshot, 'POST_ARCHIVE_OUTPUT_INTEGRITY');
        assert.equal(path.dirname(seal.paths.runOutput), seal.paths.parentOutput);
        assert.equal(seal.paths.parentOutput, path.join(seal.paths.inputRoot, 'runs'));
        assert.deepEqual(fs.readdirSync(seal.paths.parentOutput), [seal.paths.runId]);
        canonical(seal.paths.runOutput);
        fs.rmSync(seal.paths.runOutput, { recursive: true, force: false });
        fs.rmdirSync(seal.paths.parentOutput);
        lifecycle.push('authenticated-owned-output-cleaned');
      }
      checkTime();
    })();
    return cleanupCompletion;
  }
  lifecycle.push('idempotent-cleanup-enrolled');
  try {
    assert.match(executionCommit, /^[0-9a-f]{40}$/); assert.match(expectedSeal, /^[0-9a-f]{64}$/);
    assert.equal(fileURLToPath(import.meta.url), path.join(ownedRoot, 'cli-launcher.mjs'), 'LITERAL_LOCAL_MODULE_PATH');
    canonical(fileURLToPath(import.meta.url));
    canonical(ownedRoot);
    const sealBytes = fs.readFileSync(path.join(ownedRoot, 'PRESEAL.json'));
    assert.equal(sha(sealBytes), expectedSeal); seal = JSON.parse(sealBytes);
    assert.match(grantSha256, /^[0-9a-f]{64}$/); assert.match(activationToken, /^F05V5-[0-9a-f]{32}$/);
    const grantPath = path.join(ownedRoot, 'ROOT-GO.json');
    const grantStat = canonical(grantPath);
    assert.ok(grantStat.isFile() && grantStat.nlink === 1 && grantStat.size <= 32768, 'ROOT_GRANT_READ_BOUND');
    const grantBytes = fs.readFileSync(grantPath);
    assert.equal(sha(grantBytes), grantSha256);
    const grant = JSON.parse(grantBytes);
    assert.equal(grant.schema, 'f05-v5-normal-cli-root-go'); assert.equal(grant.authorized, true);
    assert.equal(grant.mode, 'PINNED_NODE_NORMAL_LOCAL_FILES_NOT_REPL_FALLBACK');
    assert.equal(grant.executionCommit, executionCommit); assert.equal(grant.presealSha256, expectedSeal);
    assert.equal(grant.profileSha256, seal.profileSha256); assert.equal(grant.token, activationToken);
    assert.equal(activationToken, seal.activationToken);
    assert.equal(grant.controllerExecutionCommit, seal.controllerExecutionCommit);
    assert.equal(grant.controllerInputSealSha256, seal.inputSealSha256);
    assert.deepEqual(grant.controllerWriteGrants, seal.paths.writeGrants);
    assert.equal(grant.overallWithCleanupMs, 300000); assert.equal(grant.peakProcesses, 2);
    assert.equal(grant.fixtureChildren, 0); assert.equal(grant.mainEngineAuthorized, false);
    assert.equal(sha(fs.readFileSync(fileURLToPath(import.meta.url))), seal.launcherSha256, 'ACTUAL_LOCAL_MODULE_HASH');
    assert.equal(seal.paths.ownedRoot, ownedRoot);
    assert.equal(seal.paths.inputRoot, '/Users/kjopek/Workspace/safe-bash/tests/commands/node-provider-experiments-20260828/repair-v4-f05-admission/inputs');
    assert.equal(seal.paths.evidenceRoot, path.join(ownedRoot, 'activation'));
    assert.equal(seal.paths.runOutput, '/Users/kjopek/Workspace/safe-bash/tests/commands/node-provider-experiments-20260828/repair-v4-f05-admission/inputs/runs/f05-admission-01');
    assert.equal(seal.paths.runId, 'f05-admission-01');
    assert.deepEqual(seal.paths.readGrants, [seal.paths.inputRoot, seal.controllerTool.origin, path.join(ownedRoot, 'controller.mjs'), path.join(ownedRoot, 'subject.mjs')]);
    assert.deepEqual(seal.paths.writeGrants, [seal.paths.parentOutput, seal.paths.runOutput, seal.paths.runOutput + '/*']);
    assert.ok(!fs.existsSync(seal.paths.parentOutput)); assert.ok(!fs.existsSync(seal.paths.runOutput)); assert.ok(!fs.existsSync(seal.paths.evidenceRoot));
    canonical(seal.paths.inputRoot);
    const stat = canonical(seal.controllerTool.origin);
    assert.ok(stat.isFile()); assert.equal(stat.size, seal.controllerTool.bytes);
    const hash = createHash('sha256');
    for await (const chunk of fs.createReadStream(seal.controllerTool.origin, { highWaterMark: 65536 })) hash.update(chunk);
    assert.equal(hash.digest('hex'), seal.controllerTool.sha256);
    immutable(); checkTime(); lifecycle.push('inputs-tool-canonical-roots-authenticated');
    assert.ok(owner.admissionOpen && !primaryPresent);
    fs.mkdirSync(seal.paths.evidenceRoot, { mode: 0o700 }); owner.evidenceCreated = true;
    lifecycle.push('new-evidence-root-owned');
    const args = seal.controllerArgs.map(value => value === '<new-code-commit40>' ? seal.controllerExecutionCommit : value);
    const expectedArgs = ['--permission', ...seal.paths.readGrants.map(name => '--allow-fs-read=' + name), ...seal.paths.writeGrants.map(name => '--allow-fs-write=' + name), '--max-old-space-size=64', '--unhandled-rejections=strict', path.join(ownedRoot, 'controller.mjs'), seal.paths.inputRoot, seal.controllerExecutionCommit, seal.inputSealSha256];
    assert.deepEqual(args, expectedArgs);
    assert.deepEqual(seal.environment, { PATH: '/usr/bin:/bin', LC_ALL: 'C', TZ: 'UTC' });
    save('CLAIM.json', { activationToken, grantSha256, executionCommit, presealSha256: expectedSeal, controllerExecutionCommit: seal.controllerExecutionCommit, deadline });
    save('LAUNCH.json', { executionCommit, presealSha256: expectedSeal, startedAt: new Date(started).toISOString(), deadline, args, environment: seal.environment, paths: seal.paths, lifecycle, mainEvaluations: 0, fixtureChildren: 0 });
    checkTime(); assert.ok(owner.admissionOpen && !primaryPresent);
    assert.equal(sha(fs.readFileSync(path.join(ownedRoot, 'controller.mjs'))), seal.controllerEntrySha256, 'LOCAL_CONTROLLER_ENTRY_HASH');
    const capture = (target, kind) => chunk => {
      if (kind === 'stdout') stdoutBytes += chunk.length; else stderrBytes += chunk.length;
      const available = Math.max(0, 65536 - retainedBytes);
      const retained = Buffer.from(chunk.subarray(0, available)); target.push(retained); retainedBytes += retained.length;
      if (stdoutBytes + stderrBytes > 65536) contain(new Error('LAUNCHER_CAPTURE_BOUND'));
    };
    owner.handle = spawn(seal.controllerTool.origin, args, { cwd: seal.paths.inputRoot, env: seal.environment, stdio: ['pipe', 'pipe', 'pipe'] });
    owner.handle.on('error', reason => { remember(reason); contain(reason); });
    owner.handle.once('close', (status, signal) => {
      owner.closeObserved = true; result = { status, signal };
      clearTimeout(grace); clearTimeout(forced); closeResolve();
    });
    owner.handle.stdout.on('data', capture(stdout, 'stdout'));
    owner.handle.stderr.on('data', capture(stderr, 'stderr'));
    owner.handle.stdin.on('error', reason => contain(reason));
    lifecycle.push('controller-owned-close-error-capture-listeners-before-publication');
    save('CONTROLLER.json', { pid: owner.handle.pid ?? null, lifecycle });
    owner.handle.stdin.end();
    await closeWait;
    owner.admissionOpen = false; lifecycle.push('actual-controller-close-observed');
    if (result.status !== 0 || result.signal !== null) remember(new Error('CONTROLLER_NOT_NATURAL_ZERO:' + result.status + ':' + result.signal));
    save('controller.stdout.raw', Buffer.concat(stdout)); save('controller.stderr.raw', Buffer.concat(stderr));
    immutable(); checkTime();
    if (fs.existsSync(seal.paths.runOutput)) {
      outputSnapshot = tree(seal.paths.runOutput);
      const plan = JSON.parse(fs.readFileSync(path.join(seal.paths.inputRoot, 'controls/PLAN.json')));
      const allowed = new Set(['LAUNCH.json', 'SOURCE-CHECKS.json', 'CAPTURE.json.gz.base64', 'REPORT.json', 'CLOSURE.json', ...plan.controls.map(row => row.id + '.json')]);
      assert.equal(outputSnapshot.directories.length, 0);
      assert.ok(Object.keys(outputSnapshot.files).every(name => allowed.has(name)));
      const payloads = Object.fromEntries(Object.keys(outputSnapshot.files).map(name => [name, fs.readFileSync(path.join(seal.paths.runOutput, name)).toString('base64')]));
      const raw = encode({ classification: 'SYNTHETIC_CONTROLLER_ARTIFACTS_NOT_ENGINE', snapshot: outputSnapshot, files: payloads });
      assert.ok(raw.length <= 16777216);
      const compressed = gzipSync(raw), encoded = Buffer.from(compressed.toString('base64') + '\n');
      assert.ok(gunzipSync(compressed, { maxOutputLength: 16777216 }).equals(raw));
      assert.ok(captureBytes + encoded.length + outputSnapshot.bytes <= 16777216);
      save('CONTROLLER-ARCHIVE.json.gz.base64', encoded);
      archiveBinding = { encodedBytes: encoded.length, encodedSha256: sha(encoded), compressedBytes: compressed.length, compressedSha256: sha(compressed), rawBytes: raw.length, rawSha256: sha(raw), files: Object.keys(payloads).length, fileBytes: outputSnapshot.bytes };
      for (const [name, base64] of Object.entries(JSON.parse(gunzipSync(Buffer.from(fs.readFileSync(path.join(seal.paths.evidenceRoot, 'CONTROLLER-ARCHIVE.json.gz.base64')).toString().trim(), 'base64'), { maxOutputLength: 16777216 })).files)) assert.equal(sha(Buffer.from(base64, 'base64')), outputSnapshot.files[name].sha256);
      owner.archiveAuthenticated = true; lifecycle.push('archive-authenticated-before-cleanup');
      try {
        const report = JSON.parse(Buffer.from(payloads['REPORT.json'], 'base64'));
        const closure = JSON.parse(Buffer.from(payloads['CLOSURE.json'], 'base64'));
        const summary = JSON.parse(Buffer.concat(stdout));
        const innerEncoded = Buffer.from(payloads['CAPTURE.json.gz.base64'], 'base64');
        const innerCompressed = Buffer.from(innerEncoded.toString().trim(), 'base64');
        const innerRaw = gunzipSync(innerCompressed, { maxOutputLength: 16777216 });
        assert.equal(sha(innerEncoded), report.capture.encodedSha256); assert.equal(sha(innerCompressed), report.capture.compressedSha256); assert.equal(sha(innerRaw), report.capture.rawSha256);
        assert.equal(summary.closureSha256, sha(Buffer.from(payloads['CLOSURE.json'], 'base64')));
        assert.equal(summary.allPass, true); assert.equal(report.integrity, true); assert.equal(closure.integrity, true); assert.equal(closure.allPass, true);
        assert.equal(report.executionCommit, seal.controllerExecutionCommit); assert.equal(closure.executionCommit, seal.controllerExecutionCommit);
        assert.equal(closure.presealSha256, seal.inputSealSha256); assert.equal(report.failure, null);
        assert.equal(report.observed, 34); assert.equal(report.passed, 34); assert.equal(report.failed, 0); assert.equal(report.unrun, 0);
        assert.equal(report.accepted, 2); assert.equal(report.rejected, 32); assert.equal(report.composedInvocations, 31); assert.equal(report.directReconcilerInvocations, 3);
        assert.equal(report.subjectImports, 1); assert.equal(report.actualEngineEvaluations, 0); assert.equal(report.harmlessChildren, 0); assert.equal(report.rescue, 0);
        assert.deepEqual(report.expected, plan.expected);
        const inner = JSON.parse(innerRaw);
        assert.deepEqual(inner.controls.map(row => row.id), plan.controls.map(row => row.id));
        assert.deepEqual(Object.keys(payloads).sort(), [...allowed].sort());
        for (const specification of plan.controls) {
          const row = JSON.parse(Buffer.from(payloads[specification.id + '.json'], 'base64'));
          assert.equal(row.status, 'PASS'); assert.equal(row.accepted, specification.accept); assert.equal(row.route, specification.route);
        }
        save('VERIFIED-COUNTS.json', { report, innerArchive: report.capture, qualification: 'Actual unchanged functions on declared inert ports; not actual engine/child/load evidence' });
      } catch (reason) { remember(reason); }
    } else remember(new Error('NO_CONTROLLER_OUTPUT_DIRECTORY'));
  } catch (reason) { remember(reason); }
  finally {
    try { await cleanup(); } catch (reason) { owner.unsafe = true; remember(reason); }
    clearTimeout(deadlineTimer); clearTimeout(grace); clearTimeout(forced);
    if (owner.evidenceCreated) {
      try {
        finalSnapshot = immutable();
        const closure = { schema: 'f05-admission-v4-owned-closure', executionCommit, presealSha256: expectedSeal, startedAt: new Date(started).toISOString(), endedAt: new Date().toISOString(), elapsedMs: Date.now() - started, allPass: !primaryPresent && !owner.unsafe && owner.closeObserved && result?.status === 0 && result?.signal === null && owner.archiveAuthenticated, primaryPresent, primary: primaryPresent ? shape(primaryReason) : null, secondary: secondary.map(shape), controllerPid: owner.handle?.pid ?? null, closeObserved: owner.closeObserved, result: result ?? null, signals, naturalController: owner.closeObserved && result.signal === null && signals.length === 0, containedController: signals.length > 0, controllerProcesses: owner.handle ? 1 : 0, fixtureChildren: 0, peakIncludingLauncher: 2, rescue: signals.length ? 1 : 0, unsafe: owner.unsafe, archiveAuthenticated: owner.archiveAuthenticated, archive: archiveBinding ?? null, stdoutBytes, stderrBytes, retainedBytes, captureTruncated: retainedBytes !== stdoutBytes + stderrBytes, captureBytesBeforeClosure: captureBytes, workBytesBeforeClosure: finalSnapshot.bytes, outputRemoved: !fs.existsSync(seal.paths.runOutput), parentRemoved: !fs.existsSync(seal.paths.parentOutput), actualEngineEvaluations: 0, lifecycle, inputAppendIntegrity: true, outputAppendIntegrity: Boolean(outputSnapshot), cleanupQualification: 'Only the exact new run directory and its empty parent; v4 immutable inputs are read only; only explicitly authorized, previously absent v4 runtime output paths are removed; historical sources/evidence are unchanged.' };
        save('CLOSURE.json', closure);
        immutable(); checkTime();
        return closure;
      } catch (reason) { owner.unsafe = true; remember(reason); }
    }
  }
  return { allPass: false, executionCommit, elapsedMs: Date.now() - started, primary: primaryPresent ? shape(primaryReason) : null, secondary: secondary.map(shape), closeObserved: owner.closeObserved, unsafe: owner.unsafe, evidenceCreated: owner.evidenceCreated, signals, qualification: 'STOP; no automatic retry or permission fallback' };
}
