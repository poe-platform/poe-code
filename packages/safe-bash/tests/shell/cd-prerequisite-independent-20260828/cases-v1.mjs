export const defaults = {
  api: 'new Shell({fs, commands: new CommandRegistry([observe]), cwd, env}); shell.exec(source, execOptions)',
  cwd: '/w', env: { HOME: '/home', OLDPWD: '/old', CDPATH: '/p:/q' },
  source: 'cd t', observeSuffix: '; observe "$?" "$PWD" "$OLDPWD"',
  initial: { cwd: '/w', PWD: '/w', OLDPWD: '/old', exported: ['HOME', 'OLDPWD', 'CDPATH', 'PWD'] },
  guard: 'G1', cleanup: 'K1', stateObservation: 'S1',
};

export const repeat = (text, count) => ({ repeat: [text, count] });
export const concat = (...parts) => ({ concat: parts });
export const typed = (code, syscall, path) => ({ kind: 'FsError', code, syscall, path });
export const stat = (path, result = 'directory') => ({ method: 'stat', path, result, signal: 'runtime-live' });
export const access = (path, result = 'success') => ({ method: 'access', path, mode: 1, result, signal: 'same-as-stat' });
export const selected = path => ({ cwd: path, PWD: path, OLDPWD: '/w', exportAdditions: ['PWD', 'OLDPWD'] });
export const success = (path, stdout = '') => ({ cdStatus: 0, stdout, stderr: '', state: selected(path), order: 'P1' });
export const failure = (payload, calls = []) => ({ cdStatus: 1, stdout: '', diagnosticPayload: payload, state: 'initial-unchanged', calls, order: 'no-publication' });

const rows = [];
const add = (id, group, input, expected, basis = 'ROOT-profile') => rows.push({ id, group, input, expected, basis });

add('B01', 'behavior', { env: { CDPATH: '/p:/q' } }, { ...success('/p/t', '/p/t\n'), calls: [stat('/p/t'), access('/p/t')] }, 'native-C01');
add('B02', 'behavior', { env: { CDPATH: '/q:/p' } }, { ...success('/q/t', '/q/t\n'), calls: [stat('/q/t'), access('/q/t')] }, 'native-C02');
for (const [id, cdpath, calls] of [
  ['B03', ':/p', [stat('/w/t'), access('/w/t')]],
  ['B04', '/missing::/p', [stat('/missing/t', typed('ENOENT', 'stat', '/missing/t')), stat('/w/t'), access('/w/t')]],
  ['B05', '/missing:', [stat('/missing/t', typed('ENOENT', 'stat', '/missing/t')), stat('/w/t'), access('/w/t')]],
]) add(id, 'behavior', { env: { CDPATH: cdpath } }, { ...success('/w/t'), calls }, 'native-C03-C05');
for (const [id, cdpath] of [['B06', null], ['B07', '']]) add(id, 'behavior', { env: { CDPATH: cdpath } }, { ...success('/w/t'), calls: [stat('/w/t'), access('/w/t')], searchSlots: 0 }, 'native-C06-C07');
add('B08', 'behavior', { env: { CDPATH: '.' } }, { ...success('/w/t', '/w/t\n'), calls: [stat('/w/t'), access('/w/t')], raw: '/w/./t', rawBytes: 6, normalizedBytes: 4 });
add('B09', 'behavior', { env: { CDPATH: 'rel' } }, { ...success('/w/rel/t', '/w/rel/t\n'), calls: [stat('/w/rel/t'), access('/w/rel/t')] }, 'native-C09');
add('B10', 'behavior', { env: { CDPATH: '/alias' }, setup: 'Memory symlink /alias -> /physical; /physical/t directory' }, { ...success('/alias/t', '/alias/t\n'), calls: [stat('/alias/t'), access('/alias/t')], forbidden: ['realpath', 'physical-cwd-publication'] }, 'native-C21');
for (const [id, source, env] of [
  ['B11', 'cd', { HOME: 't' }], ['B12', 'cd -', { OLDPWD: 't' }],
]) add(id, 'behavior', { source, env }, { ...success('/p/t', '/p/t\n'), calls: [stat('/p/t'), access('/p/t')], printCount: 1 }, id === 'B11' ? 'native-C23' : 'native-C25');
for (const [id, source, env] of [
  ['B13', "cd ''", {}], ['B14', 'cd', { HOME: '' }], ['B15', 'cd -', { OLDPWD: '' }],
]) add(id, 'behavior', { source, env }, { ...success('/w', id === 'B15' ? '/w\n' : ''), calls: [stat('/w'), access('/w')], effectiveTarget: '.', searchSlots: 0 }, id === 'B13' ? 'intentional-native-C28-gap' : 'baseline-empty-variable-not-native-measured');
add('B16', 'behavior', { source: 'cd -P', env: { CDPATH: null }, setup: 'Memory directory /w/-P' }, { ...success('/w/-P'), calls: [stat('/w/-P'), access('/w/-P')] }, 'baseline-no-option-parsing');

for (const [id, code] of [['P01', 'ENOENT'], ['P02', 'ENOTDIR'], ['P03', 'EACCES']]) add(id, 'permissions', {}, { ...success('/q/t', '/q/t\n'), calls: [stat('/p/t', typed(code, 'stat', '/p/t')), stat('/q/t'), access('/q/t')] });
add('P04', 'permissions', {}, { ...success('/q/t', '/q/t\n'), calls: [stat('/p/t', 'file'), stat('/q/t'), access('/q/t')], forbidden: ['access /p/t'] }, 'native-C15-plus-delegation');
add('P05', 'permissions', {}, { ...success('/q/t', '/q/t\n'), calls: [stat('/p/t'), access('/p/t', typed('EACCES', 'access', '/p/t')), stat('/q/t'), access('/q/t')] }, 'native-C16-plus-delegation');
add('P06', 'permissions', {}, { ...failure('cd: t: No such file or directory'), calls: [stat('/p/t', typed('EACCES', 'stat', '/p/t')), stat('/q/t', 'file'), stat('/w/t', typed('ENOENT', 'stat', '/w/t'))], finalErrorCode: 'ENOENT' }, 'native-C17-C19');
add('P07', 'permissions', { env: { CDPATH: ':' } }, { ...success('/w/t'), calls: [stat('/w/t', typed('ENOENT', 'stat', '/w/t')), stat('/w/t', typed('EACCES', 'stat', '/w/t')), stat('/w/t'), access('/w/t')], searchSlots: 2, freshFallback: true });
add('P08', 'permissions', { env: { CDPATH: ':' } }, { ...failure('cd: t: Not a directory'), calls: [stat('/w/t', typed('EACCES', 'stat', '/w/t')), stat('/w/t', typed('ENOENT', 'stat', '/w/t')), stat('/w/t', 'file')], freshFallback: true });
for (const [id, code, description] of [
  ['P09', 'EPERM', 'Operation not permitted'], ['P10', 'ELOOP', 'Too many levels of symbolic links'],
]) add(id, 'permissions', {}, { ...failure(`cd: t: ${description}`), calls: [stat('/p/t', typed(code, 'stat', '/p/t'))], laterSuccessFixtureMustRemainUncalled: '/q/t' }, 'intentional-unmeasured-native-continuation-gap');
for (const [id, code, description] of [
  ['P11', 'ENOTSUP', 'operation not supported'], ['P12', 'EIO', 'input/output error'],
  ['P13', 'ECANCELED', 'operation canceled'],
]) add(id, 'permissions', {}, { ...failure(`${code}: ${description}, access '/p/t'`), calls: [stat('/p/t'), access('/p/t', typed(code, 'access', '/p/t'))], callerSignalAborted: false });
add('P14', 'permissions', { thrown: "Object.assign(new Error('untyped-denial'), {code:'ENOENT'})" }, { ...failure('cd: t: No such file or directory'), calls: [stat('/p/t', 'untyped-error-with-ENOENT-code')], laterSuccessFixtureMustRemainUncalled: '/q/t' });

add('A01', 'adapters', { adapter: 'actual MemoryFileSystem', source: 'cd /d', setup: 'mkdir /d mode000, guard after setup' }, { ...failure('cd: /d: Permission denied'), calls: [stat('/d'), access('/d', 'actual-FsError-EACCES')], noModeInferenceInCd: true });
add('A02', 'adapters', { adapter: 'new ReadOnlyFileSystem(actual MemoryFileSystem)', source: 'cd /d', setup: 'mkdir /d mode0755 before wrapping' }, { ...success('/d'), calls: [stat('/d'), access('/d')], backingCalls: ['stat /d', 'access /d 1'], writes: 0 });
add('A03', 'adapters', { adapter: 'new MountFileSystem({root: memory, mounts:{"/m": new ReadOnlyFileSystem(backing)}})', source: 'cd /m/d', setup: 'backing mkdir /d mode0755' }, { ...success('/m/d'), calls: [stat('/m/d'), access('/m/d')], backingAccess: { path: '/d', mode: 1 }, transportRequests: 0, writes: 0 });
add('A04', 'adapters', { adapter: 'accepted WebDavFileSystem', source: 'cd /d', transport: 'DAV1:207-directory,207-directory' }, { ...success('/d'), calls: [stat('/d'), access('/d')], transportRequests: ['PROPFIND /dav/d Depth:0', 'PROPFIND /dav/d Depth:0'], writes: 0, serviceExecuted: false });
add('A05', 'adapters', { adapter: 'new ReadOnlyFileSystem(accepted WebDavFileSystem)', source: 'cd /d', transport: 'DAV1:207-directory,403' }, { ...failure('cd: /d: Permission denied'), calls: [stat('/d'), access('/d', 'actual-FsError-EACCES')], transportRequests: ['PROPFIND /dav/d Depth:0', 'PROPFIND /dav/d Depth:0'], writes: 0, serviceExecuted: false });
add('A06', 'adapters', { adapter: 'accepted WebDavFileSystem', source: 'cd /d', transport: 'DAV1:207-directory,207-file' }, { ...failure("ENOTSUP: access execute permission checks has no safe portable WebDAV equivalent, access execute permission checks '/d'"), calls: [stat('/d'), access('/d', 'actual-FsError-ENOTSUP')], transportRequests: ['PROPFIND /dav/d Depth:0', 'PROPFIND /dav/d Depth:0'], serviceExecuted: false });

add('S01', 'state', { source: 'readonly OLDPWD; cd t' }, { ...failure('OLDPWD: readonly variable'), calls: [stat('/p/t'), access('/p/t')], readonly: ['OLDPWD'], noReadonlyAttributeRemoval: true }, 'stronger-than-native-OLDPWD-stop');
add('S02', 'state', { source: 'unset PWD OLDPWD; PWD=prior; OLDPWD=prior; readonly PWD; cd t' }, { cdStatus: 1, stdout: '', diagnosticPayload: 'PWD: readonly variable', state: { cwd: '/p/t', PWD: 'prior', OLDPWD: '/w', exportedAbsent: ['PWD', 'OLDPWD'] }, calls: [stat('/p/t'), access('/p/t')], order: 'OLDPWD-write,cwd-write,PWD-checked-failure;no-export-additions;no-print' }, 'baseline-checked-PWD-partial-state');
add('S03', 'state', { source: 'PWD=prefix OLDPWD=prefix HOME=t CDPATH=/q cd' }, { ...success('/q/t', '/q/t\n'), state: { cwd: '/q/t', PWD: '/w', OLDPWD: '/old', HOME: '/home', CDPATH: '/p:/q', exported: 'initial' }, calls: [stat('/q/t'), access('/q/t')], order: 'P1-then-prefix-value-and-export-restoration' }, 'baseline-prefix-finally');
add('S04', 'state', { source: 'readonly OLDPWD; HOME=t CDPATH=/q cd' }, { ...failure('OLDPWD: readonly variable'), calls: [stat('/q/t'), access('/q/t')], restored: { HOME: '/home', CDPATH: '/p:/q' }, readonly: ['OLDPWD'] }, 'baseline-prefix-finally');
add('S05', 'state', { source: '(cd /d); observe "$?" "$PWD" "$OLDPWD"', observeSuffix: '', setup: 'directory /d' }, { cdStatus: 0, stdout: '', stderr: '', state: 'initial-unchanged', childState: selected('/d'), calls: [stat('/d'), access('/d')] }, 'baseline-subshell-clone');
add('S06', 'state', { source: 'bridge; observe "$?" "$PWD" "$OLDPWD"', observeSuffix: '', bridge: "await context.invoke('cd', ['t'], {env:{CDPATH:'/q'}})" }, { cdStatus: 0, stdout: '/q/t\n', stderr: '', state: 'initial-unchanged', childState: selected('/q/t'), calls: [stat('/q/t'), access('/q/t')] }, 'baseline-invoke-clone');
add('S07', 'state', { source: 'cd a b >/out', setup: 'Memory /out initially contains OLD', guard: 'G1-with-explicit-redirection-write' }, { ...failure('cd: too many arguments'), calls: [], fileAfter: { '/out': '' }, namespaceOtherChanges: 0 }, 'baseline-redirection-before-builtin');
add('S08', 'state', { source: 'f() { local HOME=t; cd; }; f' }, { ...success('/p/t', '/p/t\n'), restored: { HOME: '/home' }, calls: [stat('/p/t'), access('/p/t')] }, 'baseline-function-local-restoration');
add('S09', 'state', { middleware: "if(context.command==='cd') context.env.CDPATH='/q'; return await next()" }, { ...success('/q/t', '/q/t\n'), restored: { CDPATH: '/p:/q' }, calls: [stat('/q/t'), access('/q/t')] }, 'baseline-middleware-overlay-restoration');

add('O01', 'output', { stdout: 'deferred cooperative sink; hold then resolve', source: 'cd t' }, { ...success('/p/t', '/p/t\n'), calls: [stat('/p/t'), access('/p/t')], events: ['stat-enter', 'stat-resolve', 'access-enter', 'access-resolve', 'state-publication(P1-source-invariant)', 'stdout-write-enter', 'pending-exec', 'release-write', 'observe', 'exec-settled'], capturedBytes: '/p/t\n' });
add('O02', 'output', { stdout: "reject Object.assign(new Error('closed'),{code:'EPIPE'})" }, { ...success('/p/t', '/p/t\n'), cdStatus: 141, externalWriteAttempts: 1, stderr: '', order: 'P1-no-rollback-then-observe' }, 'baseline-EPIPE141');
add('O03', 'output', { stdout: "reject new Error('sink-failed')" }, { ...success('/p/t', '/p/t\n'), cdStatus: 1, stderr: 'shell: line 1: sink-failed\n', externalWriteAttempts: 1, order: 'P1-no-rollback-then-observe' }, 'baseline-ordinary-sink-mapped');
add('O04', 'output', { stdout: "reject new Error('sink-failed')", stderr: "reject new Error('diagnostic-sink-failed')" }, { ...success('/p/t', '/p/t\n'), cdStatus: 1, stderr: 'shell: line 1: sink-failed\n', externalStderrWriteAttempts: 1, execRejects: false }, 'baseline-diagnostic-capture-before-external-write');
add('O05', 'output', { source: 'other', handler: 'registered other throws Error with the supplied payload', payload: concat('cd: ', repeat('a', 65789)) }, { cdStatus: 1, calls: [], stdout: '', diagnosticPayloadBytes: 65793, physicalStderrBytes: 65809, suffixAdded: false, state: 'initial-unchanged' }, 'baseline-non-cd-diagnostic-not-globally-truncated');

add('C01', 'cancellation', { source: 'cd t', caller: "preabort with Object.assign(new Error('caller-stop'),{code:'ENOENT'})", observeSuffix: '' }, { rejects: 'exact-caller-reason', calls: [], stdout: '', stderr: '', publications: 0 });
add('C02', 'cancellation', { source: 'cd t', at: 'stat /p/t pending; caller abort; provider later rejects FsError ENOENT', observeSuffix: '' }, { rejects: 'exact-caller-reason', calls: [stat('/p/t', 'deferred')], stdout: '', laterCalls: 0, publication: 'none', lateUnhandledRejections: 0, cleanup: 'K2' });
add('C03', 'cancellation', { source: 'cd t', at: 'access /p/t pending; caller abort with FsError EACCES; provider resolves', observeSuffix: '' }, { rejects: 'exact-caller-reason', calls: [stat('/p/t'), access('/p/t', 'deferred')], stdout: '', laterCalls: 0, publication: 'none', cleanup: 'K2' });
add('C04', 'cancellation', { source: 'cd t', at: 'stdout write pending after P1; caller abort; cooperative write drains after cleanup gate', observeSuffix: '' }, { rejects: 'exact-caller-reason', calls: [stat('/p/t'), access('/p/t')], externalWriteAttempt: '/p/t\n', stateInvariant: 'P1-completed-no-rollback;not-publicly-readable-after-rejection', cleanup: 'K2' });
add('C05', 'cancellation', { source: 'cd t', env: { CDPATH: repeat('a', 65536) }, at: 'setImmediate at first 128 work units aborts caller', observeSuffix: '' }, { rejects: 'exact-caller-reason', calls: [], firstYieldAfterChargedUnits: 128, publications: 0 });

const pathError = 'cd: path exceeds 65536 UTF-8 bytes';
const cdpathError = 'cd: CDPATH exceeds 65536 UTF-8 bytes';
const slotsError = 'cd: CDPATH exceeds 4096 components';
for (const [id, source, env, payload] of [
  ['L01', 'cd a b', {}, 'cd: too many arguments'],
  ['L02', 'cd', { HOME: null }, 'cd: HOME not set'],
  ['L03', 'cd -', { OLDPWD: null }, 'cd: OLDPWD not set'],
]) add(id, 'limits', { source, env: { ...env, CDPATH: repeat('a', 65537) } }, { ...failure(payload), chargedPrivateUnits: 0 });
for (const [id, target, path] of [['L04', '/d', '/d'], ['L05', './t', '/w/t'], ['L06', '../t', '/t']]) add(id, 'limits', { source: `cd ${target}`, env: { CDPATH: repeat(':', 65537) } }, { ...success(path), calls: [stat(path), access(path)], cdpathScannedBytes: 0 });
add('L07', 'limits', { source: 'cd /d', cwd: concat('/', repeat('a', 65536)) }, { ...success('/d'), state: { ...selected('/d'), OLDPWD: concat('/', repeat('a', 65536)) }, calls: [stat('/d'), access('/d')], unusedCwdScannedBytes: 0 });
add('L08', 'limits', { env: { TARGET: concat('/', repeat('a', 65535)) }, source: 'cd "$TARGET"' }, { cdStatus: 0, stdout: '', stderr: '', candidateBytes: 65536, calls: 'one stat-directory and one X_OK at exact TARGET', work: 262146 });
add('L09', 'limits', { env: { TARGET: concat('/', repeat('a', 65536)) }, source: 'cd "$TARGET"' }, { ...failure(pathError), calls: [], pathBytes: 65537 });
add('L10', 'limits', { cwd: concat('/', repeat('a', 65535)), source: 'cd t', env: { CDPATH: '' } }, { ...failure(pathError), calls: [], inputCwdBytes: 65536, rawCandidateBytes: 65538, rawReserved: 0 });
add('L11', 'limits', { cwd: concat('/', repeat('a', 65536)), source: 'cd t' }, { ...failure(pathError), calls: [], cdpathScannedBytes: 0, inputCwdBytes: 65537 });
add('L12', 'limits', { env: { TARGET: repeat('./', 32768) }, source: 'cd "$TARGET"' }, { ...failure(pathError), calls: [], effectiveBytes: 65536, rawCandidateBytes: 65539, hypotheticalNormalized: '/w', rawReserved: 0 });
add('L13', 'limits', { env: { CDPATH: concat('/', repeat('a', 65535)) } }, { ...failure(pathError), calls: [], cdpathBytes: 65536, rawCandidateBytes: 65538, rawReserved: 0 });
add('L14', 'limits', { env: { CDPATH: repeat('a', 65537) } }, { ...failure(cdpathError), calls: [] });
add('L15', 'limits', { env: { CDPATH: repeat(':', 4096) } }, { ...failure(slotsError), calls: [], firstViolationAtByte: 4096 });
add('L16', 'limits', { env: { CDPATH: concat(repeat('a', 61441), repeat(':', 4096)) } }, { ...failure(cdpathError), calls: [], firstByteAndSlotOverflowTogether: 65537 });
add('L17', 'limits', { env: { CDPATH: concat(repeat(':', 4096), repeat('a', 61441)) } }, { ...failure(slotsError), calls: [], firstViolationAtByte: 4096 });
add('L18', 'limits', { env: { CDPATH: repeat(':', 4095) }, probes: '4096 directory-stat/access-EACCES search slots; fresh fallback directory/access-success' }, { ...success('/w/t'), searchSlots: 4096, statCalls: 4097, accessCalls: 4097, publicVfsCalls: 8194, work: 61456, yields: 480, finalYieldRemainder: 16 });
add('L19', 'limits', { cwd: concat('/', repeat('a', 48767)), env: { CDPATH: repeat(':', 55) }, probes: '56 directory-stat/access-EACCES searches then fallback directory/access-success' }, { cdStatus: 0, stdout: '', stderr: '', selected: 'cwd + /t', statCalls: 57, accessCalls: 57, work: 8388608, yields: 65536, finalYieldRemainder: 0 });
add('L20', 'limits', { cwd: concat('/', repeat('a', 48767)), env: { CDPATH: concat('.', repeat(':', 55)) }, probes: 'first four search stat=file; remaining52 stat=directory/access=EACCES; fallback stat=directory' }, { ...failure('cd: helper work limit exceeded'), calls: '4 stat-file;52(stat-directory,access-EACCES);1 fallback-stat-directory', statCalls: 57, accessCalls: 52, work: 8388608, yields: 65536, failedReservation: 1, failedOperation: 'fallback access; never called', unconstrainedWork: 8388609 });
add('L21', 'limits', { cwd: concat('/', repeat('a', 39999)), env: { CDPATH: repeat(':', 99) }, probes: 'directory-stat/access-EACCES for each admitted search' }, { ...failure('cd: helper work limit exceeded'), calls: '69(stat-directory,access-EACCES)', statCalls: 69, accessCalls: 69, work: 8320652, remaining: 67956, failedReservation: 80004, failedOperation: 'candidate70 construction; no allocation, partial charge or yield for rejected reservation' });
add('L22', 'limits', { env: { TARGET: concat('/', repeat('é', 32767), 'a') }, source: 'cd "$TARGET"' }, { cdStatus: 0, stdout: '', stderr: '', targetBytes: 65536, targetUtf16Units: 32769, calls: 'one stat-directory and one X_OK at exact TARGET' });
add('L23', 'limits', { env: { TARGET: concat('/', repeat('😀', 16384)) }, source: 'cd "$TARGET"' }, { ...failure(pathError), calls: [], targetBytes: 65537 });
add('L24', 'limits', { env: { TARGET: concat('/', repeat('\ud800', 21845)) }, source: 'cd "$TARGET"', adapter: 'Memory, no UTF16 rewrite' }, { cdStatus: 0, stdout: '', stderr: '', targetBytes: 65536, calls: 'one stat-directory and one X_OK with original unpaired UTF16 string', nativeClaim: false });
add('L25', 'limits', { source: 'cd t; cd t', env: { CDPATH: repeat(':', 4096) }, execOptions: { limits: { maxCommands: 1 } }, observeSuffix: '' }, { rejects: 'ShellLimitError with limit=maxCommands', privateFailureBeforeRejection: slotsError, commandsAdmitted: 1, calls: [], controllerReset: false });
add('L26', 'limits', { source: 'cd /d; cd /e', execOptions: { limits: { maxCommands: 2 } }, observeSuffix: '' }, { cdStatus: 0, stdout: '', stderr: '', state: { cwd: '/e', PWD: '/e', OLDPWD: '/d' }, calls: [stat('/d'), access('/d'), stat('/e'), access('/e')], noPerByteCommandCharges: true });
add('L27', 'limits', { source: 'cd t', execOptions: { limits: { maxOutputBytes: 4 } }, observeSuffix: '' }, { rejects: 'ShellLimitError with limit=maxOutputBytes', stdoutWriteAttempts: 0, stateInvariant: 'P1-completed-before-failed-5-byte-output-budget-reservation', calls: [stat('/p/t'), access('/p/t')] });

export const cases = Object.freeze(rows);

export const diagnosticCases = [
  { id: 'D01', payload: concat('cd: ', repeat('a', 65788)), originalBytes: 65792, outputBytes: 65792, truncated: false },
  { id: 'D02', payload: concat('cd: ', repeat('a', 65789)), originalBytes: 65793, retainedBytes: 65780, outputBytes: 65792, truncated: true },
  { id: 'D03', payload: concat('cd: ', repeat('a', 65775), '😀', repeat('z', 20)), retainedBytes: 65779, outputBytes: 65791, truncated: true },
  { id: 'D04', payload: concat('cd: ', repeat('😀', 16444), repeat('z', 20)), retainedBytes: 65780, outputBytes: 65792, truncated: true },
];

export const invariants = [
  'I01: Only stat then delegated X_OK; no chmod, native chdir, realpath, ACL synthesis or directory-stack mutation.',
  'I02: P1 checked publication before awaited print; readonly OLD blocks cwd; readonly PWD retains OLD/cwd; no rollback.',
  'I03: Same runtime signal for stat/access; live caller/shared abort before failure classification; no reason-shape inference.',
  'I04: Only actual FsError ENOENT/ENOTDIR/EACCES search misses; fresh duplicate fallback; first success stops.',
  'I05: All inputs/preflight bounded before first probe; raw length before allocation; normalized bound defensive.',
  'I06: Shared Budget identity/accounting unchanged; no private ShellLimits key, tick/loop charge, reset or private-controller abort.',
  'I07: Probe4098 is unreachable under4096-slot preflight; normalized bytes cannot exceed admitted absolute raw join. Verify defensively by source review, not fake public runtime passes.',
  'I08: Work reservations subtraction-first and all-or-nothing; reached128-unit boundaries yield including exact last boundary; no failed-probe refunds.',
  'I09: Diagnostic incremental bounded construction; scalar-safe payload prefix including cd: ; exact suffix; origin/newline outside private cap but parent-budgeted.',
  'I10: Prefix/clone/middleware/cleanup semantics stay baseline; post-rejection state is a source invariant, not a fabricated persistent Shell getter.',
  'I11: Provider acceptance is exact fixed composition and virtual traversal only; internal HTTP requests are not VFS-call budget units.',
  'I12: Scoped PRECODE controls are future evidence obligations; no native, adapter, product, source/moved or all-feature pass is claimed.',
];

export const integrationControls = [
  { id: 'F01', obligation: 'Authenticated future runtime-only delta over exact composed baseline; unchanged source/docs/providers/root exports and public API inventories; record full commit/blob inputs.' },
  { id: 'F02', obligation: 'Source public-root execution of frozen cases with actual provider/root FsError identity, no live-source fallback; separate denominator.' },
  { id: 'F03', obligation: 'Build/package/install only after ROOT go; actual bare virtual-bash public-root runtime and declaration identity; authenticate complete package and consumer membership.' },
  { id: 'F04', obligation: 'Physically move installed package+consumer, original absent; rerun same cases/types; separately report source/installed/moved counts without summing unique coverage.' },
  { id: 'F05', obligation: 'Negative controls reject missing public entry, modified packed runtime/provider bytes, and outside-source/dist fallback before case success; no loader error is a semantic mutant kill.' },
  { id: 'F06', obligation: '10 positive and10 intended-location negative public type checks per future layout; each negative independently inverted; no missing-import/fixture pass.' },
  { id: 'F07', obligation: 'After ROOT go only: scoped existing shell/contracts/adapter regression selection authenticated against candidate; preserve original native28/provider cohorts, no current full-gate claim.' },
];
