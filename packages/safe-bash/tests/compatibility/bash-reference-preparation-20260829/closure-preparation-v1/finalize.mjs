import { lstat, readFile, writeFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
const root = fileURLToPath(new URL('./', import.meta.url));
const previous = fileURLToPath(new URL('../source-preparation-v1/', import.meta.url));
await writeFile(root + 'FINALIZE-STARTUP.json', JSON.stringify({ at: new Date().toISOString(), children: 0, sourceOnly: true }) + '\n', { flag: 'wx', mode: 0o600 });
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const save = (name, value) => writeFile(root + name, JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
try {
  const parentBytes = await readFile(root + 'BUILD-FENCE-PROFILE.json');
  assert.equal(hash(parentBytes), '0d483ca59ee76011a001c10dd096ad623b7e36ac1e054e88e77c02d8c476fad0');
  const profile = JSON.parse(parentBytes);
  const tools = JSON.parse(await readFile(root + 'RUN-01/TOOL-IDENTITIES.json', 'utf8'));
  const dispatch = JSON.parse(await readFile(root + 'BOOTSTRAP-DISPATCH.json', 'utf8'));
  assert.equal(dispatch.selector.link, '/bin/bash');
  assert.equal(dispatch.selector.isSymbolicLink, true);
  const sh = tools.find(row => row.path === '/bin/sh'); assert(sh && !sh.absent);
  profile.id = 'BASH53-BUILD-PROFILE-P2';
  profile.parentProfileSha256 = hash(parentBytes);
  profile.revision = 'Source-only explicit selector binding plus corrected actual GNU 5.3 generated helper edges; P1 retained, no runtime rescore.';
  profile.executableRows.push(sh); profile.executableFiles.push(sh); profile.readFiles.push(sh);
  profile.directShDispatch = { permitted: 'PROPOSED_ONLY_AFTER_ROOT_GO_AND_PROBES', selector: { ...dispatch.selector, targetBytesSha256: hash(dispatch.selector.link) }, allowedTarget: tools.find(row => row.path === '/bin/bash'), otherFallbackShellsPermitted: false, runtimeObserved: false };
  profile.commands.configure = { executable: '/bin/sh', argv: ['<B>/source/configure', '--prefix=<B>/out', '--cache-file=/dev/null'], cwd: '<B>/build' };
  profile.environment.CONFIG_SHELL = '/bin/sh'; profile.environment.SHELL = '/bin/sh';
  profile.generatedExecutables = profile.generatedExecutables.filter(row => row.path !== '<B>/build/mkversion');
  profile.generatedExecutables.push(
    { path: '<B>/build/bashversion', role: 'Version-report helper used by .build prerequisite, not a shell oracle', source: 'Makefile.in:113,118,633,639,643,698' },
    { path: '<B>/build/builtins/psize.aux', role: 'Pipe-size helper invoked through source psize.sh; actual target reachability pending', source: 'builtins/Makefile.in:250-256' },
    { path: '<B>/build/builtins/gen-helpfiles', role: 'Conditional helpfile generator; no execution allowance unless configured graph admits it', source: 'builtins/Makefile.in:215' }
  );
  profile.generatedScripts = [{ path: '<B>/source/support/mkversion.sh', source: 'Makefile.in:696', role: 'Source-owned version header generator through admitted shell' }, { path: '<B>/build/config.status', source: 'configure', role: 'Generated shell script; per-generation/source/argv admission remains unimplemented' }];
  profile.buildCapsProposal.phaseSeconds = { admission: 120, probes: 420, configure: 900, make: 900, versionAndMetadata: 60, cleanupAndPublication: 300 };
  assert.equal(Object.values(profile.buildCapsProposal.phaseSeconds).reduce((sum, value) => sum + value, 0), profile.buildCapsProposal.wallSeconds);
  profile.frozenProbeIDs = Array.from({ length: 14 }, (_, index) => 'F' + String(index + 1).padStart(2, '0'));
  profile.probesExecuted = 0;
  await save('BUILD-FENCE-PROFILE-P2.json', profile);
  const inventory = JSON.parse(await readFile(previous + 'RUN-01/FINAL-SOURCE-INVENTORY.json', 'utf8'));
  const helperFiles = ['Makefile.in', 'builtins/Makefile.in', 'support/mkversion.sh', 'builtins/psize.sh'];
  const helperBindings = [];
  for (const name of helperFiles) {
    const row = inventory.rows.find(item => item.path === 'bash-5.3/' + name); assert(row);
    const pathname = inventory.source + '/' + name; const stat = await lstat(pathname); assert(stat.isFile() && stat.size === row.bytes && stat.size <= 1048576);
    const bytes = await readFile(pathname); assert.equal(hash(bytes), row.sha256);
    helperBindings.push({ path: name, bytes: row.bytes, sha256: row.sha256, sourceInventoryHash: inventory.sha256 });
  }
  await save('HELPER-P2-BINDINGS.json', { helperBindings, exactCodeReferences: [{ path: 'Makefile.in', line: 696, expressionRole: 'SHELL invokes support/mkversion.sh' }, { path: 'Makefile.in', line: 643, expressionRole: '.build invokes BUILD_DIR/bashversion -l' }, { path: 'builtins/Makefile.in', line: 251, expressionRole: 'SHELL invokes source psize.sh' }], runtimeExecuted: false });
  const result = JSON.parse(await readFile(root + 'RUN-01/RESULT.json', 'utf8'));
  assert.equal(result.status, 'METADATA_COMPLETE'); assert.equal(result.starts, 2); assert.equal(result.closedChildren, 2); assert(result.ownedClosed);
  const summary = JSON.parse(await readFile(root + 'RUN-01/SUMMARY.json', 'utf8'));
  await save('HANDOFF.json', { status: 'PREPARATION_COMPLETE_BUILD_HELD', signatureCommit: 'fe5d87a215310cbe847bee99bbe3c7650aa3f6e3', sourceCommit: 'efcd8b49a63ceb4276ae9d075da59bfb027b3510', metadataPreseal: '2ba8bff61c542c6b6d74dd5ee06374d48131b73e', profileP1Sha256: hash(parentBytes), profileP2Sha256: hash(JSON.stringify(profile, null, 2) + '\n'), summary, metadataChildrenClosed: 2, activeOwnedChildren: 0, buildExecutions: 0, fenceActivations: 0, proposedProbes: 14, probesExecuted: 0, readFilesInP2: profile.readFiles.length, executableAliasesInP2: profile.executableRows.length, executableFilesInP2: profile.executableFiles.length });
  const records = [];
  const walk = async (directory, prefix = '') => {
    for (const entry of (await readdir(directory, { withFileTypes: true })).sort((left, right) => Buffer.compare(Buffer.from(left.name), Buffer.from(right.name)))) {
      const pathname = directory + '/' + entry.name;
      const name = prefix + entry.name;
      if (entry.isDirectory()) await walk(pathname, name + '/');
      else { const stat = await lstat(pathname); assert(entry.isFile() && !entry.isSymbolicLink() && stat.size <= 8 * 1024 * 1024); const bytes = await readFile(pathname); if (/\.(?:md|mjs)$/.test(name)) assert(!bytes.toString('utf8').split('\n').some(line => /[ \t]+$/.test(line)), 'NEW_PROSE_OR_CODE_WHITESPACE'); records.push({ path: name, bytes: stat.size, mode: (stat.mode & 0o777).toString(8), sha256: hash(bytes) }); }
    }
  };
  await walk(root.slice(0, -1));
  const totalBytes = records.reduce((sum, row) => sum + row.bytes, 0); assert(totalBytes < 64 * 1024 * 1024);
  await save('FINAL-SEAL.json', { records, totalBytes, canonicalRowsSha256: hash(JSON.stringify(records)), captureModeAuthority: 'Owned creation and observed lstat; not Git index mode', noPrivateOrProductMutation: true, runtimeQualified: false });
} catch (error) { await save('FINALIZE-FAILURE.json', { message: error.message, stack: error.stack }); process.exitCode = 1; }
