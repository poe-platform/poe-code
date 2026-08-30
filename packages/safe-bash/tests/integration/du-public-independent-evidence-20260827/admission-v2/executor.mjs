import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { appendFileSync, chmodSync, createWriteStream, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, readlinkSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { once } from 'node:events';
import { finished } from 'node:stream/promises';
import { createGzip, gunzipSync } from 'node:zlib';
import { join, relative } from 'node:path';
import { repository, owned, recipeRoot, runRoot, nodeBinary, originalSix, sha256, gitBlob, regular, json, census, safeRelative, entries, authenticateReference, inventoryGuard, modeGuard, bindingKeysGuard, identityGuard, isolationGuard, publicHold, exactNames, publicGuard, git, superviseGit } from './common.mjs';

function archiveMembers(pack, limit) {
  const tar = gunzipSync(pack, { maxOutputLength: limit });
  const members = {};
  let offset = 0;
  let pending = null;
  function text(header, start, length) { return header.subarray(start, start + length).toString().replace(/\0.*$/su, ''); }
  function octal(header, start, length) { const value = text(header, start, length).trim(); assert.match(value || '0', /^[0-7]+$/u); return parseInt(value || '0', 8); }
  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every(byte => byte === 0)) { assert.ok(tar.subarray(offset).every(byte => byte === 0)); break; }
    const checksum = octal(header, 148, 8);
    let actual = 0;
    for (let index = 0; index < 512; index++) actual += index >= 148 && index < 156 ? 32 : header[index];
    assert.equal(actual, checksum, 'tar header checksum');
    const size = octal(header, 124, 12);
    assert.ok(Number.isSafeInteger(size) && size >= 0 && offset + 512 + size <= tar.length);
    const body = tar.subarray(offset + 512, offset + 512 + size);
    const prefix = text(header, 345, 155);
    const base = text(header, 0, 100);
    const name = prefix ? `${prefix}/${base}` : base;
    const type = String.fromCharCode(header[156]);
    assert.equal(text(header, 157, 100), '', 'archive links forbidden');
    if (type === 'x') {
      assert.equal(pending, null, 'multiple pending pax headers');
      pending = {};
      let cursor = 0;
      while (cursor < body.length) {
        const space = body.indexOf(32, cursor);
        assert.ok(space > cursor);
        const length = Number(body.subarray(cursor, space).toString());
        assert.ok(Number.isSafeInteger(length) && length > 0 && cursor + length <= body.length);
        const record = body.subarray(space + 1, cursor + length).toString();
        assert.ok(record.endsWith('\n'));
        const equal = record.indexOf('=');
        assert.ok(equal > 0);
        const key = record.slice(0, equal);
        assert.ok(['path', 'mtime', 'atime', 'ctime', 'uid', 'gid', 'uname', 'gname', 'size'].includes(key), `unsupported pax ${key}`);
        assert.ok(!Object.hasOwn(pending, key));
        pending[key] = record.slice(equal + 1, -1);
        cursor += length;
      }
    } else {
      assert.ok(type === '0' || type === '\0', `nonregular archive member ${type}`);
      const effective = pending?.path ?? name;
      safeRelative(effective);
      assert.ok(effective.startsWith('package/'));
      if (pending?.size) assert.equal(Number(pending.size), size);
      const member = effective.slice('package/'.length);
      safeRelative(member);
      assert.ok(!Object.hasOwn(members, member), 'duplicate archive member');
      assert.ok((octal(header, 100, 8) & 0o170000) === 0 || (octal(header, 100, 8) & 0o170000) === 0o100000);
      members[member] = sha256(body);
      pending = null;
      assert.ok(Object.keys(members).length <= 2000, 'archive member bound');
    }
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  assert.equal(pending, null);
  assert.ok(offset + 1024 <= tar.length, 'two tar end blocks');
  return members;
}

function packGuard({ author, reproduced, members, expected, expectedSha256, reproductionSucceeded }) {
  assert.ok(Buffer.isBuffer(author), 'pinned pack unavailable');
  assert.equal(sha256(author), expectedSha256, 'author pack sha256');
  assert.equal(reproductionSucceeded, true, 'reproduction failed');
  assert.ok(Buffer.isBuffer(reproduced));
  assert.equal(sha256(reproduced), expectedSha256, 'reproduced whole-pack sha256');
  assert.ok(author.equals(reproduced), 'direct whole-pack byte equality');
  assert.deepEqual(members, expected, 'whole package census');
}

function selectedLive(prepared) {
  const records = [];
  for (const selector of prepared.selectors) {
    const filename = join(repository, selector);
    if (!existsSync(filename)) { records.push({ path: selector, type: 'missing' }); continue; }
    const stat = lstatSync(filename);
    assert.ok(!stat.isSymbolicLink());
    if (stat.isDirectory()) {
      records.push({ path: selector, type: 'directory', mode: stat.mode & 0o777 });
      records.push(...census(filename).map(record => ({ ...record, path: `${selector}/${record.path}` })));
    } else records.push({ path: selector, type: 'file', mode: stat.mode & 0o777, bytes: stat.size, sha256: sha256(regular(filename)) });
  }
  return records;
}

export async function run(seal) {
  const recipe = json(join(recipeRoot, 'recipe.json'));
  const closure = json(join(recipeRoot, 'closure.json'));
  const registry = json(join(recipeRoot, 'registry.json'));
  const prepared = json(join(repository, owned, 'preparation.v1.json'));
  assert.equal(runRoot, recipe.outputDirectory);
  assert.ok(!existsSync(runRoot), 'unique one-shot output directory already exists');
  mkdirSync(runRoot, { mode: 0o755 });
  const started = Date.now();
  const eventsFile = join(runRoot, 'events.jsonl');
  const bounds = recipe.bounds;
  const work = recipe.isolation;
  const candidate = join(work, 'candidate');
  const state = { schemaVersion: 2, seal, mode: recipe.mode, startedAt: new Date(started).toISOString(), specifiedControls: 11, applicableControls: 9, heldControls: ['A06', 'P03'], controls: [], authenticatedInputs: 0, materializedInputs: 0, emittedFiles: 0, packageMembers: 0, packReproduced: false, publicAdmitted: false, duCasesExecuted: 0, heldDuCases: 29, childrenStarted: 0, childrenClosed: 0, childProcessesActive: 0, peakChildOutputBytes: 0, peakObservedDiskBytes: 0, phase: 'pre-authentication', failure: null, scratchRemoved: false };
  let settling = false;
  let eventBytes = 0;
  function event(value) {
    const line = `${JSON.stringify({ elapsedMs: Date.now() - started, ...value })}\n`;
    eventBytes += Buffer.byteLength(line);
    assert.ok(eventBytes <= bounds.maxObservationBytes, 'event byte bound');
    appendFileSync(eventsFile, line);
  }
  function save(name, value) { writeFileSync(join(runRoot, name), `${JSON.stringify(value, null, 2)}\n`); }
  function receipt() { save('RESULT.json', state); }
  function deadline() { assert.ok(Date.now() - started <= bounds.totalTimeoutMs, 'total admission time bound'); }
  function startChild() { if (!settling) deadline(); assert.ok(++state.childrenStarted <= bounds.maxChildren); state.childProcessesActive++; assert.equal(state.childProcessesActive, 1); }
  function closeChild() { state.childrenClosed++; state.childProcessesActive--; }
  superviseGit((stage, args, details) => {
    if (stage === 'before') startChild();
    else { closeChild(); event({ kind: 'git-close', args, ...details }); }
  });
  function diskBytes(root) {
    let total = 0;
    let count = 0;
    function visit(directory) {
      for (const name of readdirSync(directory)) {
        const filename = join(directory, name);
        const stat = lstatSync(filename);
        assert.ok(++count <= bounds.maxTreeEntries);
        assert.ok(!stat.isSymbolicLink(), 'run symlink forbidden');
        if (stat.isDirectory()) visit(filename); else { assert.ok(stat.isFile()); total += stat.size; }
      }
    }
    visit(root);
    state.peakObservedDiskBytes = Math.max(state.peakObservedDiskBytes, total);
    assert.ok(total <= bounds.maxDiskBytes, 'owned disk bound');
    return total;
  }
  function phase(name) { state.phase = name; if (!settling) deadline(); event({ kind: 'phase', name }); receipt(); }
  const blobs = new Map();
  let retainedBytes = 0;
  function blob(entry) {
    if (!blobs.has(entry.gitBlob)) {
      const bytes = git('cat-file', 'blob', entry.gitBlob);
      retainedBytes += bytes.length;
      assert.ok(retainedBytes <= bounds.maxGitBufferBytes, 'aggregate retained Git blob bound');
      blobs.set(entry.gitBlob, bytes);
    }
    return blobs.get(entry.gitBlob);
  }
  function protectedSnapshot() {
    for (const entry of recipe.protectedFiles) {
      const bytes = regular(join(repository, entry.path));
      assert.equal(lstatSync(join(repository, entry.path)).mode & 0o777, 0o644);
      assert.equal(sha256(bytes), entry.sha256, entry.path);
      assert.equal(gitBlob(bytes), entry.gitBlob);
      assert.deepEqual(bytes, blob(entry));
    }
    const oldTree = census(join(repository, prepared.oldFreeze.directory));
    assert.deepEqual(oldTree.filter(record => record.type === 'file').map(record => `${prepared.oldFreeze.directory}/${record.path}`).sort(), recipe.protectedFiles.filter(entry => entry.path.startsWith(`${prepared.oldFreeze.directory}/`)).map(entry => entry.path).sort());
    assert.deepEqual(oldTree.filter(record => record.type === 'directory').map(record => record.path), ['consumers']);
    assert.deepEqual(readdirSync(join(repository, owned)).sort(), [...originalSix, 'admission-v2', 'run-v2'].sort(), 'new preparation-root entries');
    return { original21: recipe.protectedFiles, original15Tree: oldTree, original6RootNames: readdirSync(join(repository, owned)).sort(), recipeTree: census(recipeRoot) };
  }
  function toolsSnapshot() {
    for (const binary of closure.binaries) {
      assert.equal(realpathSync(binary.path), binary.realpath);
      assert.equal(lstatSync(binary.path).mode & 0o777, binary.mode);
      assert.equal(sha256(regular(binary.path)), binary.sha256);
    }
    assert.equal(readlinkSync(closure.npmLauncher.path), closure.npmLauncher.link);
    assert.equal(lstatSync(closure.npmLauncher.path).mode & 0o777, closure.npmLauncher.mode);
    assert.equal(realpathSync(closure.npmLauncher.path), closure.npmLauncher.realpath);
    assert.equal(lstatSync(closure.npmLauncher.realpath).mode & 0o777, closure.npmLauncher.targetMode);
    assert.equal(sha256(regular(closure.npmLauncher.realpath)), closure.npmLauncher.targetSha256);
    for (const item of closure.packages) { assert.equal(realpathSync(item.root), item.realpath); assert.equal(lstatSync(item.root).mode & 0o777, item.rootMode); }
    const packages = closure.packages.map(item => ({ name: item.name, records: census(item.root, item.name === 'npm') }));
    for (let index = 0; index < packages.length; index++) identityGuard(packages[index].records, closure.packages[index].records, 'tool dependency closure');
    return { binaries: closure.binaries, npmLauncher: closure.npmLauncher, packages };
  }
  function negative(id, name, operation) {
    let caught;
    try { operation(); } catch (error) { caught = error; }
    event({ kind: 'negative-control-receipt', id, mutation: name, rejected: Boolean(caught), message: caught?.message ?? null });
    assert.ok(caught, `${id}/${name} failed to reject`);
  }
  function control(id, operation) {
    phase(id);
    const countBefore = state.controls.length;
    try {
      const details = operation();
      state.controls.push({ id, status: 'PASS-admission-guard-not-semantic', ...details });
      receipt();
    } catch (error) {
      if (state.controls.length === countBefore) state.controls.push({ id, status: 'FAIL', error: error.message });
      receipt();
      throw error;
    }
  }
  let pre;
  let handoff;
  let inventory;
  let authorPack;
  let originalMembers;
  let stagedPre;
  let materializedPre;
  async function child(label, argv, timeoutMs) {
    const environment = {};
    for (const [key, value] of Object.entries(recipe.environment)) {
      if (['inherited', 'NODE_OPTIONS', 'NODE_PATH'].includes(key)) continue;
      environment[key] = value.replaceAll('${work}', work).replaceAll('${run}', runRoot);
    }
    environment.DU_ADMISSION_WORK = work;
    environment.DU_ADMISSION_RUN = runRoot;
    environment.DU_ADMISSION_LOG = join(runRoot, `${label}-actual-loads.jsonl`);
    startChild();
    event({ kind: 'child-start', label, argv, cwd: candidate, environment });
    const processChild = spawn(nodeBinary, argv.slice(1), { cwd: candidate, env: environment, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let outputBytes = 0;
    let fault = null;
    let termination;
    let observedError;
    function stop(error) {
      if (fault) return;
      fault = error;
      event({ kind: 'watchdog-failure', label, error: error.message });
      try { process.kill(-processChild.pid, 'SIGTERM'); } catch {}
      termination = setTimeout(() => { try { process.kill(-processChild.pid, 'SIGKILL'); } catch {} }, bounds.terminationGraceMs);
    }
    processChild.on('error', error => { observedError = error; });
    for (const [stream, name] of [[processChild.stdout, 'stdout'], [processChild.stderr, 'stderr']]) {
      stream.on('data', chunk => {
        outputBytes += chunk.length;
        state.peakChildOutputBytes = Math.max(state.peakChildOutputBytes, outputBytes);
        if (chunk.length > bounds.maxChildChunkBytes || outputBytes > bounds.maxChildOutputBytes) return stop(new Error('child output bound'));
        appendFileSync(join(runRoot, `${label}.${name}.log`), chunk);
      });
    }
    const timer = setTimeout(() => stop(new Error(`${label} timeout`)), timeoutMs);
    const poll = setInterval(() => { try { deadline(); diskBytes(runRoot); } catch (error) { stop(error); } }, bounds.watchdogPollMs);
    const [status, signal] = await new Promise(resolve => processChild.once('close', (...args) => resolve(args)));
    clearTimeout(timer); clearInterval(poll); clearTimeout(termination);
    closeChild();
    const result = { label, pid: processChild.pid, status, signal, outputBytes, watchdogFailure: fault?.message ?? null, spawnError: observedError?.message ?? null, closed: true };
    event({ kind: 'child-close', ...result });
    save(`${label}-status.json`, result);
    receipt();
    assert.equal(fault, null); assert.equal(observedError, undefined); assert.equal(status, 0); assert.equal(signal, null);
    const observations = regular(environment.DU_ADMISSION_LOG, bounds.maxObservationBytes).toString().trim().split('\n').map(line => JSON.parse(line));
    const expectedFiles = new Map();
    for (const item of closure.packages) for (const record of item.records.filter(record => record.type === 'file')) expectedFiles.set(join(work, item.destination, record.path), record.sha256);
    const loads = observations.filter(item => item.kind === 'actual-commonjs-compile');
    const loadProof = { moduleCompiles: loads.length, actualFileReads: observations.filter(item => item.kind === 'actual-file-read').length, productModuleCompiles: loads.filter(item => !item.path.startsWith(`${work}/tools/npm/`) && !item.path.startsWith(`${candidate}/node_modules/`)).length, entryObserved: loads.some(item => item.path === argv[4]), exitObserved: observations.some(item => item.kind === 'tool-observer-exit' && item.code === 0) };
    save(`${label}-load-proof.json`, loadProof);
    assert.ok(loadProof.entryObserved && loadProof.exitObserved);
    assert.equal(loadProof.productModuleCompiles, 0);
    for (const load of loads) { assert.equal(load.diskSha256, expectedFiles.get(load.path)); assert.equal(load.compileSha256, load.diskSha256); }
    state[`${label}LoadProof`] = loadProof;
    return result;
  }
  try {
    event({ kind: 'run-start', seal, held: registry.controls.filter(item => item.execution === 'HELD-unexecuted-no-pass') });
    modeGuard(recipe);
    isolationGuard(recipe.isolation);
    assert.deepEqual(registry.controls.map(item => item.definition), json(join(repository, owned, 'controls.v1.json')).controls);
    bindingKeysGuard(registry.originalBindingMapping, Object.keys(json(join(repository, prepared.oldFreeze.directory, 'bindings.template.json')).required));
    pre = { protected: protectedSnapshot(), tools: toolsSnapshot(), liveSelected: selectedLive(prepared) };
    save('PRE.json', pre);
    const expectedSupervisor = json(join(recipeRoot, 'MANIFEST.json')).files.find(record => record.path === 'executor.mjs');
    identityGuard(pre.protected.recipeTree.find(record => record.path === 'executor.mjs'), expectedSupervisor, 'sealed independent admission supervisor');
    handoff = JSON.parse(authenticateReference(prepared.handoff));
    for (const identity of prepared.references) authenticateReference(identity);
    inventory = handoff.sourceInventory;
    authorPack = regular(recipe.pack.path);
    assert.equal(lstatSync(recipe.pack.path).mode & 0o777, recipe.pack.mode);
    assert.equal(authorPack.length, recipe.pack.bytes);
    assert.equal(sha256(authorPack), recipe.pack.sha256);
    save('author-pack-authentication.json', { bytes: authorPack.length, sha256: sha256(authorPack), fullMemberCensusPending: true });
    control('S01', () => {
      assert.equal(handoff.candidateCommit, prepared.candidateCommit);
      assert.equal(handoff.sourceCommit, prepared.sourceCommit);
      assert.equal(handoff.candidateTree, git('rev-parse', `${prepared.candidateCommit}^{tree}`).toString().trim());
      assert.equal(handoff.rootReplayAuthorization, null);
      assert.equal(inventory.length, 771);
      assert.equal(sha256(JSON.stringify(inventory)), prepared.inventory.jsonSha256);
      assert.deepEqual(entries(prepared.candidateCommit, prepared.selectors), inventory.map(({ path, mode, type, gitBlob }) => ({ path, mode, type, gitBlob })));
      assert.deepEqual(entries(prepared.candidateCommit, prepared.productSelectors), entries(prepared.sourceCommit, prepared.productSelectors));
      inventoryGuard(inventory, inventory, blob);
      state.authenticatedInputs = inventory.length;
      assert.deepEqual(handoff.outputOperationIntegration, registry.originalLifecycleMapping);
      return { inputs: inventory.length, admitted: false, heldDuCases: 29, originalWrapperExecuted: false };
    });
    control('A01', () => {
      for (const input of [{ authorNames: handoff.html74Checkpoint.names }, { unacceptedStreamingRepair: true }]) {
        const result = publicHold(input);
        event({ kind: 'held-control-receipt', id: 'A01', input, result });
        assert.equal(result.status, 'HELD'); assert.equal(result.duCasesExecuted, 0); assert.equal(result.admitted, false);
      }
      return { mutations: 2 };
    });
    control('A02', () => {
      for (const [name, value] of [['old-mode', { ...recipe, mode: 'committed-archive' }], ['transient-relabel', { ...recipe, transientRelabel: true }], ['full-history-claim', { ...recipe, fullHistoryArchiveProof: true }]]) negative('A02', name, () => modeGuard(value));
      return { mutations: 3, oldValidatorDispatched: false };
    });
    control('A03', () => {
      const first = inventory[0];
      const mutations = [
        ['changed-path', { ...first, path: 'different-input' }], ['duplicate', inventory[1]], ['traversal', { ...first, path: '../escape' }], ['symlink', { ...first, mode: '120000' }], ['nonregular', { ...first, type: 'tree' }], ['mode', { ...first, mode: '100755' }], ['blob', { ...first, gitBlob: '0'.repeat(40) }], ['hash', { ...first, sha256: '0'.repeat(64) }],
      ];
      for (const [name, entry] of mutations) negative('A03', name, () => inventoryGuard([entry, ...inventory.slice(1)], inventory));
      negative('A03', 'removed', () => inventoryGuard(inventory.slice(1), inventory));
      negative('A03', 'extra', () => inventoryGuard([...inventory, { ...first, path: 'extra-input' }], inventory));
      negative('A03', 'changed-bytes', () => inventoryGuard(inventory, inventory, entry => entry === first ? Buffer.from('changed') : blob(entry)));
      const helper = inventory.find(entry => entry.path === 'src/shell/cancellation.ts');
      assert.ok(helper);
      negative('A03', 'later-helper-bytes', () => inventoryGuard(inventory, inventory, entry => entry === helper ? Buffer.from('later helper forbidden') : blob(entry)));
      return { mutations: 12, beforeMaterialization: state.materializedInputs === 0 };
    });
    control('A04', () => {
      originalMembers = archiveMembers(authorPack, bounds.maxInflatedTarBytes);
      assert.deepEqual(originalMembers, handoff.packageFiles);
      const base = { author: authorPack, reproduced: authorPack, members: originalMembers, expected: handoff.packageFiles, expectedSha256: recipe.pack.sha256, reproductionSucceeded: true };
      negative('A04', 'absent-pack', () => packGuard({ ...base, author: null }));
      const partial = { ...originalMembers }; delete partial['README.md'];
      negative('A04', 'partial-census', () => packGuard({ ...base, members: partial }));
      negative('A04', 'changed-nonloaded-member', () => packGuard({ ...base, members: { ...originalMembers, 'README.md': '0'.repeat(64) } }));
      const different = Buffer.from(authorPack); different[4] ^= 1;
      assert.deepEqual(archiveMembers(different, bounds.maxInflatedTarBytes), originalMembers);
      negative('A04', 'same-all-members-different-tar-bytes', () => packGuard({ ...base, reproduced: different }));
      negative('A04', 'failed-reproduction', () => packGuard({ ...base, reproductionSucceeded: false }));
      return { mutations: 5, positiveReproductionNotInferred: true, authorMembers: Object.keys(originalMembers).length };
    });
    control('A05', () => {
      const keys = Object.keys(registry.originalBindingMapping);
      const structural = registry.originalBindingMapping;
      for (const key of keys) { const value = { ...structural }; delete value[key]; negative('A05', `missing-${key}`, () => bindingKeysGuard(value, keys)); }
      negative('A05', 'missing-root-approval', () => assert.ok(recipe.authorization.acceptedHtml74, 'root HTML acceptance missing'));
      negative('A05', 'unauthorized-supervisor', () => identityGuard({ ...expectedSupervisor, sha256: '0'.repeat(64) }, expectedSupervisor, 'sealed independent admission supervisor'));
      negative('A05', 'unauthorized-tool', () => identityGuard({ ...closure.binaries[0], sha256: '0'.repeat(64) }, closure.binaries[0], 'tool binary identity'));
      const changedHelpers = structuredClone(pre.protected.recipeTree); changedHelpers.find(record => record.path === 'common.mjs').sha256 = '0'.repeat(64);
      negative('A05', 'changed-helper', () => identityGuard(changedHelpers, pre.protected.recipeTree, 'protected tree'));
      const changed = structuredClone(closure.packages[1].records); changed.find(record => record.type === 'file').sha256 = '0'.repeat(64);
      negative('A05', 'changed-dependency', () => identityGuard(changed, closure.packages[1].records, 'tool dependency closure'));
      negative('A05', 'unspecified-isolation', () => isolationGuard(undefined));
      negative('A05', 'new-protected-tree-entry', () => identityGuard([...pre.protected.original15Tree, { path: 'extra' }], pre.protected.original15Tree, 'protected tree'));
      return { mutations: keys.length + 7, requiredKeys: keys.length, positiveAuthenticityNotClaimed: true };
    });
    control('A07', () => {
      const metadataBefore = entries(prepared.candidateCommit, prepared.selectors);
      const liveStatus = git('status', '--porcelain=v1', '-z', '--untracked-files=normal');
      const index = git('diff', '--cached', '--name-only', '-z');
      save('A07-live-observation.json', { liveStatusSha256: sha256(liveStatus), statusEntries: liveStatus.toString().split('\0').filter(Boolean), foreignIndexNames: index.toString().split('\0').filter(Boolean), liveBytesConsumedForBuild: 0, indexMutatedByControl: false });
      assert.ok(liveStatus.length > 0, 'actual unrelated worktree edits required');
      assert.deepEqual(entries(prepared.candidateCommit, prepared.selectors), metadataBefore);
      inventoryGuard(inventory, inventory, blob);
      return { observedUnrelatedLiveWork: true, foreignIndexRequired: false, noGlobalIndexEqualityRequired: true };
    });
    control('P01', () => {
      const validShapeOnly = { rootExport: true, subpathExport: true, sourceFallback: false, loadProofPresent: true, loadProofAuthenticated: true, consumerMatched: true, helperMatched: true, symlinkInstall: false, oldMoveLocationExists: false };
      for (const key of Object.keys(validShapeOnly)) negative('P01', key, () => publicGuard({ ...validShapeOnly, [key]: !validShapeOnly[key] }));
      return { mutations: 9, actualPublicLoadExecuted: false, originalGuards: 'P03-P06/R03 remain future obligations' };
    });
    control('P02', () => {
      const names = handoff.declared75Inventory.names;
      negative('P02', 'count74', () => exactNames(names.slice(1), names));
      negative('P02', 'count76', () => exactNames([...names, 'extra'], names));
      negative('P02', 'duplicate75', () => exactNames([names[1], ...names.slice(1)], names));
      negative('P02', 'substituted75', () => exactNames(['substitute', ...names.slice(1)], names));
      return { mutations: 4, comparatorRole: 'author-name negative guard fixture, not authenticated root-approved inventory' };
    });
    phase('authenticate-all-771');
    inventoryGuard(inventory, inventory, entry => {
      const bytes = git('cat-file', 'blob', entry.gitBlob);
      assert.deepEqual(bytes, blob(entry));
      return bytes;
    });
    phase('materialize-all-771');
    mkdirSync(candidate, { recursive: true, mode: 0o755 });
    for (const entry of inventory) {
      const target = join(candidate, safeRelative(entry.path));
      mkdirSync(join(target, '..'), { recursive: true, mode: 0o755 });
      writeFileSync(target, blob(entry), { flag: 'wx', mode: 0o644 });
      state.materializedInputs++;
    }
    materializedPre = census(candidate);
    const materializedFiles = materializedPre.filter(record => record.type === 'file');
    assert.equal(materializedFiles.length, 771);
    const expectedInputs = new Map(inventory.map(entry => [entry.path, entry]));
    for (const record of materializedFiles) { assert.equal(record.sha256, expectedInputs.get(record.path)?.sha256); assert.equal(record.mode, 0o644); }
    save('materialized-inputs.json', materializedPre);
    phase('stage-exact-tool-closure');
    for (const item of closure.packages) {
      const destination = join(work, item.destination);
      mkdirSync(destination, { recursive: true, mode: 0o755 });
      for (const record of item.records) {
        const target = join(destination, record.path);
        if (record.type === 'directory') { mkdirSync(target, { recursive: true, mode: record.mode }); chmodSync(target, record.mode); }
        else if (record.type === 'file') {
          const bytes = regular(join(item.root, record.path));
          assert.equal(sha256(bytes), record.sha256);
          mkdirSync(join(target, '..'), { recursive: true, mode: 0o755 });
          writeFileSync(target, bytes, { flag: 'wx', mode: record.mode }); chmodSync(target, record.mode);
        }
      }
      assert.deepEqual(census(destination), item.records.filter(record => record.type !== 'symlink'));
    }
    stagedPre = closure.packages.map(item => ({ name: item.name, records: census(join(work, item.destination)) }));
    save('staged-tools-PRE.json', stagedPre);
    for (const name of ['home', 'tmp', 'cache', 'prefix']) mkdirSync(join(work, name), { recursive: true });
    for (const name of ['empty.npmrc', 'empty-global.npmrc']) writeFileSync(join(work, name), '', { flag: 'wx' });
    mkdirSync(join(runRoot, 'pack'));
    diskBytes(runRoot);
    phase('build');
    const argv = template => template.map(value => value.replaceAll('${work}', work).replaceAll('${run}', runRoot));
    await child('build', argv(recipe.commands.build), bounds.buildTimeoutMs);
    phase('compare-dist-832');
    const dist = census(join(candidate, 'dist'));
    const emitted = Object.fromEntries(dist.filter(record => record.type === 'file').map(record => [record.path, record.sha256]));
    state.emittedFiles = Object.keys(emitted).length;
    save('dist-census.json', dist); receipt();
    assert.equal(state.emittedFiles, 832); assert.deepEqual(emitted, handoff.emittedFiles);
    phase('pack');
    await child('pack', argv(recipe.commands.pack), bounds.packTimeoutMs);
    phase('compare-whole-pack-834');
    const packNames = readdirSync(join(runRoot, 'pack'));
    assert.deepEqual(packNames, ['virtual-bash-0.0.0.tgz']);
    const reproduced = regular(join(runRoot, 'pack', packNames[0]));
    const members = archiveMembers(reproduced, bounds.maxInflatedTarBytes);
    state.packageMembers = Object.keys(members).length;
    state.reproducedPackBytes = reproduced.length;
    state.reproducedPackSha256 = sha256(reproduced);
    state.directWholePackByteEqual = authorPack.equals(reproduced);
    save('pack-census.json', members); receipt();
    packGuard({ author: authorPack, reproduced, members, expected: handoff.packageFiles, expectedSha256: recipe.pack.sha256, reproductionSucceeded: true });
    assert.equal(state.packageMembers, 834);
    state.packReproduced = true;
  } catch (error) {
    state.failure = { phase: state.phase, name: error.name, message: error.message, stack: error.stack };
    event({ kind: 'required-failure-stop', ...state.failure });
    receipt();
  } finally {
    settling = true;
    try {
      phase('post-authentication');
      const post = { protected: protectedSnapshot(), tools: toolsSnapshot(), liveSelected: selectedLive(prepared) };
      save('POST.json', post);
      identityGuard(post, pre, 'protected/source/tool/fixture PRE/POST including new entries');
      assert.deepEqual(regular(recipe.pack.path), authorPack);
      if (inventory) {
        assert.deepEqual(entries(prepared.candidateCommit, prepared.selectors), inventory.map(({ path, mode, type, gitBlob }) => ({ path, mode, type, gitBlob })));
        inventoryGuard(inventory, inventory, entry => git('cat-file', 'blob', entry.gitBlob));
      }
      if (stagedPre) {
        const stagedPost = closure.packages.map(item => ({ name: item.name, records: census(join(work, item.destination)) }));
        save('staged-tools-POST.json', stagedPost); assert.deepEqual(stagedPost, stagedPre);
      }
      if (materializedPre) {
        const materializedPost = census(candidate).filter(record => record.path !== 'node_modules' && !record.path.startsWith('node_modules/') && record.path !== 'dist' && !record.path.startsWith('dist/'));
        save('materialized-inputs-POST.json', materializedPost); assert.deepEqual(materializedPost, materializedPre);
      }
      state.postUnchanged = true;
    } catch (error) {
      state.postFailure = { message: error.message, stack: error.stack };
      state.failure ??= { phase: 'post-authentication', ...state.postFailure };
      event({ kind: 'post-failure', ...state.postFailure });
    }
    try {
      assert.equal(state.childProcessesActive, 0);
      assert.equal(state.childrenStarted, state.childrenClosed);
      if (materializedPre) {
        phase('archive-own-scratch');
        const gzip = createGzip({ level: 9 });
        const destination = createWriteStream(join(runRoot, 'committed-inputs.jsonl.gz'), { flags: 'wx' });
        gzip.pipe(destination);
        const completion = finished(destination);
        for (const entry of inventory) {
          const line = `${JSON.stringify({ ...entry, base64: blob(entry).toString('base64') })}\n`;
          if (!gzip.write(line)) await once(gzip, 'drain');
        }
        gzip.end(); await completion;
        state.inputArchive = { path: 'committed-inputs.jsonl.gz', files: inventory.length, sha256: sha256(regular(join(runRoot, 'committed-inputs.jsonl.gz'))) };
      }
      phase('cleanup-settlement');
      if (existsSync(join(runRoot, 'node_modules'))) rmSync(join(runRoot, 'node_modules'), { recursive: true });
      state.scratchRemoved = !existsSync(join(runRoot, 'node_modules'));
      state.childrenSettled = state.childProcessesActive === 0;
      diskBytes(runRoot);
    } catch (error) { state.cleanupFailure = error.message; state.failure ??= { phase: 'cleanup-settlement', message: error.message }; }
    superviseGit(undefined);
    state.finishedAt = new Date().toISOString();
    state.elapsedMs = Date.now() - started;
    state.actualApplicablePasses = state.controls.filter(item => item.status === 'PASS-admission-guard-not-semantic').length;
    state.applicableFailed = state.controls.filter(item => item.status === 'FAIL').length;
    state.applicableUnexecuted = registry.applicable - state.controls.length;
    state.outcome = state.failure ? 'STOPPED-no-retry' : 'ADMISSION-BUILD-PROOF-ONLY-public29-HELD';
    state.phase = 'settled';
    event({ kind: 'run-settled', outcome: state.outcome, childrenStarted: state.childrenStarted, childrenClosed: state.childrenClosed, scratchRemoved: state.scratchRemoved });
    receipt();
    const evidence = census(runRoot).filter(record => record.type === 'file');
    save('EVIDENCE-MANIFEST.json', { seal, files: evidence, manifestExcludesOnlySelf: true, postDetectsNewEntries: true });
    console.log(JSON.stringify({ outcome: state.outcome, controls: state.actualApplicablePasses, held: 2, inputs: state.materializedInputs, emittedFiles: state.emittedFiles, packageMembers: state.packageMembers, packReproduced: state.packReproduced, failure: state.failure, manifestSha256: sha256(regular(join(runRoot, 'EVIDENCE-MANIFEST.json'))) }));
    if (state.failure) process.exitCode = 1;
  }
}
