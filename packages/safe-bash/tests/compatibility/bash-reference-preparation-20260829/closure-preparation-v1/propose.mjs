import { lstat, readlink, readFile, writeFile } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
const root = fileURLToPath(new URL('./', import.meta.url));
const previous = fileURLToPath(new URL('../source-preparation-v1/', import.meta.url));
await writeFile(root + 'PROPOSAL-STARTUP.json', JSON.stringify({ at: new Date().toISOString(), sourceMetadataOnly: true, children: 0 }) + '\n', { flag: 'wx', mode: 0o600 });
const began = performance.now();
const save = (name, value) => writeFile(root + name, JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
const json = async pathname => { const status = await lstat(pathname); assert(status.isFile() && status.size < 8 * 1024 * 1024); return JSON.parse(await readFile(pathname, 'utf8')); };
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
try {
  const tools = await json(root + 'RUN-01/TOOL-IDENTITIES.json');
  const graph = await json(root + 'RUN-01/LOADER-GRAPH.json');
  const sdk = await json(root + 'RUN-01/SDK-SCOPE.json');
  const inventory = await json(previous + 'RUN-01/FINAL-SOURCE-INVENTORY.json');
  const prior = await json(fileURLToPath(new URL('../verification-v2/plan-r2.json', import.meta.url)));
  const cacheRows = prior.closure.filter(row => /dyld_shared_cache/.test(row.resolved ?? row.path) || (row.resolved ?? row.path) === '/usr/lib/dyld');
  assert.equal(cacheRows.length, 16);
  let streamedBytes = 0;
  const cacheIdentities = [];
  for (const row of cacheRows) {
    assert(performance.now() - began < 300000);
    const pathname = row.resolved ?? row.path;
    assert(pathname.startsWith('/System/') || pathname === '/usr/lib/dyld');
    const status = await lstat(pathname); assert(status.isFile() && !status.isSymbolicLink());
    assert.equal(status.size, row.bytes); assert.equal((status.mode & 0o777).toString(8), row.mode);
    streamedBytes += status.size; assert(streamedBytes <= 8 * 1024 ** 3);
    const hash = createHash('sha256'); for await (const bytes of createReadStream(pathname, { highWaterMark: 65536 })) hash.update(bytes);
    assert.equal(hash.digest('hex'), row.sha256);
    cacheIdentities.push({ ...row, path: pathname });
  }
  let selector;
  try {
    const status = await lstat('/private/var/select/sh');
    selector = { path: '/private/var/select/sh', mode: (status.mode & 0o777).toString(8), isSymbolicLink: status.isSymbolicLink() };
    if (status.isSymbolicLink()) selector.link = await readlink('/private/var/select/sh');
    else selector.refusal = 'REGULAR_SELECTOR_CONTENT_NOT_INSPECTED';
  } catch (error) { if (error.code === 'ENOENT') selector = { path: '/private/var/select/sh', absent: true }; else throw error; }
  const manualPath = '/usr/share/man/man1/sh.1';
  const manualStatus = await lstat(manualPath); assert(manualStatus.isFile() && manualStatus.size <= 262144);
  const manual = await readFile(manualPath, 'utf8');
  const manualRows = manual.split('\n').flatMap((line, index) => /re.exec|select\/sh|supported shells|bash|dash|zsh/i.test(line) ? [{ line: index + 1, concepts: ['re-exec', 'select/sh', 'supported shells', 'bash', 'dash', 'zsh'].filter(word => line.toLowerCase().includes(word)) }] : []);
  await save('BOOTSTRAP-DISPATCH.json', { selector, manual: { path: manualPath, bytes: manualStatus.size, sha256: digest(manual), lineClassifications: manualRows }, dispatcherRan: false, selectedRuntimeObserved: false, proposal: 'Use explicitly pinned /bin/bash as CONFIG_SHELL and SHELL with absent ENV/BASH_ENV and noninteractive invocation, rather than claiming /bin/sh identity closes its dispatch. Any remaining hardcoded /bin/sh call is a separate unqualified interpreter edge, not permission to allow all fallback shells.' });
  const sourceRows = [];
  for (const filename of ['Makefile.in', 'builtins/Makefile.in', 'configure']) {
    const expected = inventory.rows.find(row => row.path === 'bash-5.3/' + filename);
    const pathname = inventory.source + '/' + filename;
    const status = await lstat(pathname); assert(status.isFile() && status.size === expected.bytes && status.size <= 4 * 1024 * 1024);
    const text = await readFile(pathname, 'utf8'); assert.equal(digest(text), expected.sha256);
    const rows = text.split('\n').flatMap((line, index) => {
      if (/^\s*#/.test(line)) return [];
      const classes = [];
      if (/mkbuiltins|mksyntax|mkversion|mksignames/.test(line)) classes.push('GENERATED_HELPER_REFERENCE');
      if (/conftest/.test(line)) classes.push('CONFIGURE_PROBE_REFERENCE');
      if (/config\.status/.test(line)) classes.push('GENERATED_SHELL_SCRIPT_REFERENCE');
      if (/\/bin\/sh/.test(line)) classes.push('EXPLICIT_SH_DISPATCH_REFERENCE');
      if (/CONFIG_SHELL|MAKE_SHELL|CC_FOR_BUILD/.test(line)) classes.push('BOOTSTRAP_SELECTION_REFERENCE');
      return classes.length ? [{ line: index + 1, classes }] : [];
    });
    sourceRows.push({ filename, sha256: expected.sha256, rows });
  }
  await save('GENERATED-SOURCE-BINDINGS.json', { sourceInventoryHash: inventory.sha256, sourceRows, referencesNotExecutionProof: true });
  const excludedExecutables = ['/bin/sh', '/Library/Developer/CommandLineTools/usr/bin/llvm-otool', '/usr/bin/sandbox-exec', '/usr/bin/eslogger', '/usr/sbin/dtrace'];
  const executableRows = tools.filter(row => !row.absent && !excludedExecutables.includes(row.path));
  const executableFiles = [...new Map(executableRows.map(row => [row.resolved, row])).values()];
  const readFiles = [...new Map([...executableRows, ...graph.libraryIdentities, ...sdk.headers, ...sdk.stubs, ...sdk.metadataRows.filter(row => !row.absent), ...cacheIdentities].map(row => [row.resolved ?? row.path, row])).values()];
  const bootstrap = tools.find(row => row.path === '/bin/bash'); assert(bootstrap && !bootstrap.absent);
  const clang = tools.find(row => row.path.endsWith('/usr/bin/clang'));
  const linker = tools.find(row => row.path.endsWith('/usr/bin/ld'));
  const make = tools.find(row => row.path.endsWith('/usr/bin/make'));
  const ar = tools.find(row => row.path.endsWith('/usr/bin/ar'));
  const ranlib = tools.find(row => row.path.endsWith('/usr/bin/ranlib'));
  const driver = `${clang.path} -isysroot ${sdk.sdk} -resource-dir ${sdk.proposedResourceRoot} --ld-path=${linker.path} -mmacosx-version-min=26.4`;
  const profile = {
    id: 'BASH53-BUILD-PROFILE-P1', status: 'PROPOSED_INACTIVE_NOT_SBPL_VALIDATED', implementedThrough: null,
    sourceInventoryHash: inventory.sha256, sourceCommit: 'efcd8b49a63ceb4276ae9d075da59bfb027b3510',
    rootParameter: '<FRESH_CANONICAL_OWNED_BUILD_ROOT>', default: 'DENY',
    executableRows, executableFiles, executablePolicy: 'Exact admitted path identities, preserve original argv0 aliases such as ranlib. No executable directory blanket.',
    directShDispatch: { permitted: false, reason: 'Dispatcher edge is unqualified; explicit Bash bootstrap proposal requires ROOT approval and source/probe confirmation.' },
    readFiles, readDataPolicy: 'Exact literal source/tool/header/stub/library/cache files only; no blanket SDK/toolchain/system/home read permission.',
    ownedReadWrite: ['<B>/build', '<B>/home', '<B>/tmp', '<B>/out'], ownedReadOnly: ['<B>/source', '<B>/bin', '<B>/profile'],
    metadataPolicy: 'Only ancestors and exact admitted files plus declared negative SDK candidate observations; do not equate metadata permission with byte permission.',
    devices: ['/dev/null', '/dev/urandom', '/dev/random'], network: 'DENY_ALL', userHomeRepoPrivate: 'DENY_ALL', machServices: [], otherIPC: 'DENY_UNLESS_SEPARATELY_JUSTIFIED',
    generatedExecutables: [
      { path: '<B>/build/conftest', role: 'Repeated configure compiler/link/run probe, one admission per generation', source: 'configure' },
      { path: '<B>/build/mkversion', role: 'Build version-header generator', source: 'Makefile.in' },
      { path: '<B>/build/mksignames', role: 'Build signal-name generator', source: 'Makefile.in' },
      { path: '<B>/build/mksyntax', role: 'Build syntax-table generator', source: 'Makefile.in' },
      { path: '<B>/build/builtins/mkbuiltins', role: 'Builtin source/help generator', source: 'builtins/Makefile.in' },
      { path: '<B>/out/bash-5.3.15', role: 'One later version-only observation, not configure/make script execution', source: 'Completed authenticated build output' }
    ],
    generatedAdmission: 'Source/recipe/probe generation + compiler argv + output identity must be recorded. Exact-path sandbox is not atomic hash interposition; executable admission implementation remains unqualified.',
    scriptBoundary: 'An admitted interpreter can execute inline/stdin/owned-script code; process-exec path rules alone do not authenticate script content or argv. Source read scope and audited recipe graph are distinct controls.',
    commands: { configure: { executable: bootstrap.path, argv: ['--noprofile', '--norc', '<B>/source/configure', '--prefix=<B>/out', '--cache-file=/dev/null'], cwd: '<B>/build' }, make: { executable: make.path, argv: ['-j1', 'bash'], cwd: '<B>/build' }, version: { executable: '<B>/out/bash-5.3.15', argv: ['--noprofile', '--norc', '--version'], deadlineMs: 3000, perStreamBytes: 65536 } },
    environment: { HOME: '<B>/home', TMPDIR: '<B>/tmp', PATH: '<B>/bin', LANG: 'C', LC_ALL: 'C', TZ: 'UTC', TERM: 'dumb', CONFIG_SITE: '/dev/null', CONFIG_SHELL: bootstrap.path, SHELL: bootstrap.path, CC: driver, CC_FOR_BUILD: driver, CFLAGS: '-O2', CFLAGS_FOR_BUILD: '-O2', AR: ar.path, RANLIB: ranlib.path, MAKE: make.path, SDKROOT: sdk.sdk, DEVELOPER_DIR: '/Library/Developer/CommandLineTools', MACOSX_DEPLOYMENT_TARGET: '26.4' },
    environmentPolicy: 'Fresh exact map; no inherited ENV/BASH_ENV/functions/flags/credentials/DYLD variables. Driver flag support is unexecuted; failure is a refusal, not permission to remove flags silently.',
    SDKQualification: { headers: sdk.headers.length, stubs: sdk.stubs.length, exactBytesHashed: true, wholeSDK: false, preprocessingClosure: false, unresolvedCandidates: sdk.unresolved.length, pendingCandidates: sdk.pendingHeaderCandidates, missingStubs: sdk.missingStubs },
    census: { mechanismQualified: false, topLevelWaitSufficient: false, psPollingSufficient: false, forkExecExitAndPIDReuseRequired: true, lostEventsStop: true, fastEventOvershootHardCapNotProved: true, eslogger: 'Installed identity only; privileges/TCC/schema/filtering/completeness untested; broad host event capture forbidden.' },
    buildCapsProposal: { wallSeconds: 2700, allProcessStarts: 16384, peakProcesses: 16, captureBytes: 134217728, workBytes: 2147483648, retries: 0 },
    activationRequires: ['ROOT_BUILD_GO', 'EXACT_POLICY_RENDERER_PRESEAL', 'SOURCE_BOUND_INTERPRETER_AND_HELPER_ADMISSION', 'BUILD_SPECIFIC_FENCE_PROBES', 'OBSERVABLE_DESCENDANT_AND_LOSS_PROTOCOL', 'EXACT_DRIVER_FLAG_AND_SDK_NEGATIVE_PROBE_CLASSIFICATION']
  };
  await save('BUILD-FENCE-PROFILE.json', profile);
  await save('CACHE-BINDING.json', { identities: cacheIdentities, streamedBytes, storedCacheBytes: 0, imageMembershipNotInspected: true, runtimeLoaderNotObserved: true });
  console.log(JSON.stringify({ status: 'INACTIVE_PROFILE_PREPARED', selector, cacheFiles: cacheIdentities.length, cacheBytesStreamed: streamedBytes, executableAliases: executableRows.length, uniqueExecutables: executableFiles.length, exactReadFiles: readFiles.length, headers: sdk.headers.length, stubs: sdk.stubs.length, bootstrapProposed: bootstrap.path, changedFromOldShProposal: true, profileSha256: digest(JSON.stringify(profile, null, 2) + '\n'), elapsedMs: performance.now() - began }));
} catch (error) { await save('PROPOSAL-FAILURE.json', { message: error.message, stack: error.stack }); process.exitCode = 1; }
