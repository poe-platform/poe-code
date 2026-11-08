import assert from 'node:assert/strict';

export function applyOverlay(name, original) {
  let source = original;
  function replace(before, after) {
    assert.equal(source.split(before).length, 2, `${name}: exact single delta anchor`);
    source = source.replace(before, after);
  }
  if (name === 'common.mjs') {
    replace("export const runRoot = join(repository, owned, 'run-v2');", "export const runRoot = join(repository, owned, 'run-v3');");
    replace('HOME: runRoot, TMPDIR: runRoot', "HOME: join(runRoot, 'node_modules/work/home'), TMPDIR: join(runRoot, 'node_modules/work/tmp')");
    replace("const target = realpathSync(filename);\n        assert.ok(target.startsWith(`${resolve(root)}/`), 'tool alias escapes closure');\n        records.push({ ...record, type: 'symlink', link: readlinkSync(filename), realpath: target, targetSha256: sha256(regular(target)) });", "const link = readlinkSync(filename);\n        const target = resolve(directory, link);\n        assert.ok(target.startsWith(`${resolve(root)}/`), 'tool alias escapes closure');\n        records.push({ ...record, type: 'symlink', link, realpath: target });");
    replace("visit(root);\n  return records.sort", "visit(root);\n  for (const alias of records.filter(record => record.type === 'symlink')) {\n    const target = records.find(record => record.path === relative(root, alias.realpath));\n    assert.equal(target?.type, 'file', 'metadata alias must target an independently enumerated regular file');\n    alias.targetSha256 = target.sha256;\n  }\n  return records.sort");
  } else {
    assert.equal(name, 'executor.mjs');
    replace("from './common.mjs';", "from './common.mjs';\nimport { expectedTree, freshGuard, focusedControls, postAudit } from '/Users/kjopek/Workspace/safe-bash/tests/integration/du-public-independent-evidence-20260827/admission-v3/support.mjs';");
    const begin = source.indexOf('function selectedLive(prepared) {');
    const end = source.indexOf('\nexport async function run(seal)', begin);
    assert.ok(begin > 0 && end > begin);
    replace(source.slice(begin, end), '');
    replace("const recipe = json(join(recipeRoot, 'recipe.json'));", "const recipe = json(join(recipeRoot, 'recipe.json'));\n  recipe.outputDirectory = runRoot;\n  recipe.isolation = join(runRoot, 'node_modules/work');\n  recipe.commands.pack = recipe.commands.pack.map(value => value === '${run}/pack' ? '${work}/pack' : value);\n  const overlayRoot = join(repository, owned, 'admission-v3');\n  const overlayBinding = json(join(overlayRoot, 'bindings.json'));\n  const overlayManifest = json(join(overlayRoot, 'MANIFEST.json'));");
    replace("assert.ok(!existsSync(runRoot), 'unique one-shot output directory already exists');\n  mkdirSync(runRoot, { mode: 0o755 });", "assert.ok(existsSync(runRoot), 'launcher owns unique one-shot run');\n  assert.ok(!existsSync(join(runRoot, 'RESULT.json')), 'one executor invocation only');");
    replace('const started = Date.now();', 'const started = seal.launcher.started;');
    replace('childrenStarted: 0, childrenClosed: 0, childProcessesActive: 0', 'childrenStarted: seal.launcher.childrenStarted, childrenClosed: seal.launcher.childrenClosed, childProcessesActive: 0');
    replace('let retainedBytes = 0;', 'let retainedBytes = 0;\n  let distPre;');
    const protectedBegin = source.indexOf('  function protectedSnapshot() {');
    const protectedEnd = source.indexOf('  function toolsSnapshot() {', protectedBegin);
    replace(source.slice(protectedBegin, protectedEnd), `  function protectedSnapshot() {
    for (const entry of overlayBinding.protectedFiles) {
      const bytes = regular(join(repository, entry.path));
      assert.equal(lstatSync(join(repository, entry.path)).mode & 0o777, 0o644);
      assert.equal(bytes.length, entry.bytes);
      assert.equal(sha256(bytes), entry.sha256, entry.path);
      assert.equal(gitBlob(bytes), entry.gitBlob);
      assert.deepEqual(bytes, blob(entry));
    }
    const overlayTree = census(overlayRoot);
    const expectedOverlay = [...overlayManifest.files, { path: 'MANIFEST.json', mode: 0o644, type: 'file', bytes: regular(join(overlayRoot, 'MANIFEST.json')).length, sha256: seal.manifestSha256 }].sort((left, right) => left.path.localeCompare(right.path, 'en'));
    assert.deepEqual(overlayTree, expectedOverlay, 'sealed overlay exact namespace');
    const effectiveModules = census(join(work, 'overlay'));
    assert.deepEqual(effectiveModules, overlayManifest.effectiveModules, 'authenticated applied module bytes');
    const oldTree = census(join(repository, prepared.oldFreeze.directory));
    assert.deepEqual(oldTree.filter(record => record.type === 'file').map(record => prepared.oldFreeze.directory + '/' + record.path).sort(), recipe.protectedFiles.filter(entry => entry.path.startsWith(prepared.oldFreeze.directory + '/')).map(entry => entry.path).sort());
    assert.deepEqual(oldTree.filter(record => record.type === 'directory').map(record => record.path), ['consumers']);
    const recipeTree = census(recipeRoot);
    const baseManifest = json(join(recipeRoot, 'MANIFEST.json'));
    assert.deepEqual(recipeTree, [...baseManifest.files, { path: 'MANIFEST.json', mode: 0o644, type: 'file', bytes: regular(join(recipeRoot, 'MANIFEST.json')).length, sha256: overlayBinding.baseManifestSha256 }].sort((left, right) => left.path.localeCompare(right.path, 'en')));
    return { protected37: overlayBinding.protectedFiles, original15Tree: oldTree, recipeTree, overlayTree, effectiveModules };
  }
  function selectedPinned() {
    const pinned = JSON.parse(authenticateReference(prepared.handoff)).sourceInventory;
    assert.equal(pinned.length, 771);
    assert.equal(sha256(JSON.stringify(pinned)), prepared.inventory.jsonSha256);
    assert.deepEqual(entries(prepared.candidateCommit, prepared.selectors), pinned.map(({ path, mode, type, gitBlob }) => ({ path, mode, type, gitBlob })));
    inventoryGuard(pinned, pinned, entry => git('cat-file', 'blob', entry.gitBlob));
    return pinned;
  }
  function candidateExpected(includeDist = true) {
    const files = materializedPre.filter(record => record.type === 'file');
    const directories = new Map();
    for (const item of closure.packages.filter(item => item.destination.startsWith('candidate/'))) {
      const prefix = item.destination.slice('candidate/'.length);
      for (const record of item.records) {
        if (record.type === 'file') files.push({ ...record, path: prefix + '/' + record.path });
        else if (record.type === 'directory') directories.set(prefix + '/' + record.path, record.mode);
      }
      directories.set(prefix, item.rootMode);
    }
    if (includeDist && distPre) for (const record of distPre) if (record.type === 'file') files.push({ ...record, path: 'dist/' + record.path });
    const expected = new Map(expectedTree(files, safeRelative).map(record => [record.path, record]));
    for (const [path, mode] of directories) expected.set(path, { path, mode, type: 'directory' });
    return [...expected.values()].sort((left, right) => left.path.localeCompare(right.path, 'en'));
  }
`);
    replace('pre = { protected: protectedSnapshot(), tools: toolsSnapshot(), liveSelected: selectedLive(prepared) };', 'pre = { protected: protectedSnapshot(), tools: toolsSnapshot(), selectedGit: selectedPinned() };');
    replace("    control('S01', () => {", "    focusedControls({ work, inventory, inventoryGuard, safeRelative, census, sha256, state, event, receipt, phase });\n    control('S01', () => {");
    replace("    save('materialized-inputs.json', materializedPre);", "    save('materialized-inputs.json', materializedPre);\n    freshGuard(materializedPre, expectedTree(inventory.map(entry => ({ path: entry.path, mode: 0o644, type: 'file', bytes: blob(entry).length, sha256: entry.sha256 })), safeRelative), safeRelative);");
    replace("    save('staged-tools-PRE.json', stagedPre);", "    save('staged-tools-PRE.json', stagedPre);\n    freshGuard(census(candidate), candidateExpected(false), safeRelative);");
    replace("    mkdirSync(join(runRoot, 'pack'));", "    mkdirSync(join(work, 'pack'));");
    replace("    assert.equal(state.emittedFiles, 832); assert.deepEqual(emitted, handoff.emittedFiles);", "    assert.equal(state.emittedFiles, 832); assert.deepEqual(emitted, handoff.emittedFiles);\n    freshGuard(dist, expectedTree(dist.filter(record => record.type === 'file').map(record => ({ ...record, mode: 0o644 })), safeRelative), safeRelative);\n    distPre = dist;");
    replace("    const packNames = readdirSync(join(runRoot, 'pack'));", "    const packNames = readdirSync(join(work, 'pack'));");
    replace("    const reproduced = regular(join(runRoot, 'pack', packNames[0]));", "    const reproduced = regular(join(work, 'pack', packNames[0]));\n    writeFileSync(join(runRoot, 'reproduced-package.tgz'), reproduced, { flag: 'wx' });");
    const postBegin = source.indexOf('      const post = { protected: protectedSnapshot()');
    const postEnd = source.indexOf('      state.postUnchanged = true;', postBegin);
    assert.ok(postBegin > 0 && postEnd > postBegin);
    replace(source.slice(postBegin, postEnd), `      const post = {};
      const checks = [
        ['protected37-and-recipes', () => { post.protected = protectedSnapshot(); save('POST.json', post); identityGuard(post.protected, pre?.protected, 'protected PRE/POST'); }],
        ['full-tool-closure', () => { post.tools = toolsSnapshot(); save('POST.json', post); identityGuard(post.tools, pre?.tools, 'tools PRE/POST'); }],
        ['complete-pinned-Git-selection', () => { post.selectedGit = selectedPinned(); save('POST.json', post); identityGuard(post.selectedGit, pre?.selectedGit, 'pinned Git PRE/POST'); }],
        ['author-pack', () => { const bytes = regular(recipe.pack.path); assert.equal(lstatSync(recipe.pack.path).mode & 0o777, recipe.pack.mode); assert.equal(bytes.length, recipe.pack.bytes); assert.equal(sha256(bytes), recipe.pack.sha256); if (authorPack) assert.deepEqual(bytes, authorPack); }],
      ];
      if (stagedPre) checks.push(['fresh-staged-tools', () => { const stagedPost = closure.packages.map(item => ({ name: item.name, records: census(join(work, item.destination)) })); save('staged-tools-POST.json', stagedPost); assert.deepEqual(stagedPost, stagedPre); }]);
      if (materializedPre) checks.push(['complete-fresh-candidate', () => { const actual = census(candidate); save('materialized-inputs-POST.json', actual); freshGuard(actual, candidateExpected(), safeRelative); }]);
      state.postAudits = postAudit(checks, save);
      state.postAuditScope = state.failure ? 'standalone recovery checks after failed normal gate; not a composite pass' : 'normal gate';
      assert.ok(state.postAudits.every(record => record.status === 'PASS'), 'one or more post guards failed');
`);
    replace('    state.actualApplicablePasses =', "    state.focusedNegativePasses = (state.focusedControls ?? []).filter(record => record.status === 'PASS-negative-only').length;\n    state.focusedNegativeUnexecuted = 6 - (state.focusedControls ?? []).length;\n    state.actualApplicablePasses =");
  }
  return source;
}
