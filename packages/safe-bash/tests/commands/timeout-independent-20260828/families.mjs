const family = (id, name, basis, vectors, assertions, method = 'public-command-context') => ({ id, name, basis, vectors, assertions, method, status: 'FROZEN-PROSPECTIVE-NOT-EXECUTED' });

export const families = Object.freeze([
  family('F01', 'exact factories and declaration surface', ['api.json'], {
    names: ['createTimeoutCommand', 'createTimeoutCommands', 'timeoutCommands', 'TimeoutScheduler', 'TimeoutCommandOptions', 'TimeoutCommandsOptions'],
    calls: ['createTimeoutCommand()', 'createTimeoutCommands()', 'timeoutCommands()'],
  }, ['exact three runtime factories and three declared types; no TimeoutLimits/capability/fourth factory', 'fresh shallow-frozen definition named timeout; fresh shallow-frozen singleton of frozen definition', 'fresh plugin timeout-commands captures singleton before setup', 'strict options and readonly return declarations; exact absent/undefined optional types from packet', 'no root/subpath/default registration inferred from module availability'], 'module-plus-strict-declarations'),
  family('F02', 'options container validation', ['api.json/optionsContainer'], {
    accepted: ['omitted', 'undefined', '{}', 'Object.create(null)', 'class instance'],
    rejected: ['null', 'false', '0', 'string', 'Symbol', 'BigInt', 'function', 'array'], factories: ['createTimeoutCommand', 'createTimeoutCommands', 'timeoutCommands'],
  }, ['all rejected containers synchronously TypeError before definition returned', 'unknown own property getter and ownKeys trap are never touched', 'ordinary inherited properties accepted', 'no clock/timer/invoker/stream/context access at construction']),
  family('F03', 'option values and exact error class', ['api.json/propertyValidation'], {
    invoke: ['undefined', 'callable', 'null', '0', '{}'], scheduler: ['undefined', 'valid object', 'null', 'array', 'function', 'missing each method', 'each noncallable method'],
    maximumValid: [1, 2, 2147483647], maximumTypeError: ['null', 'string', 'boolean', 'BigInt', 'object'], maximumRangeError: ['NaN', 'Infinity', '-Infinity', 0, -1, 1.5, 2147483648],
    replaceValid: ['undefined', false, true], replaceInvalid: ['null', '0', 'string', 'object'],
  }, ['exact synchronous TypeError versus RangeError per packet', 'single factory does not read replace; family/plugin do', 'undefined maximum selects2147483647; undefined replace selectsfalse', 'provider methods never argument-probed during construction']),
  family('F04', 'single ordered property reads and abrupt completion', ['api.json/propertyReadSequences'], {
    order: ['options.invoke', 'options.scheduler', 'scheduler.now', 'scheduler.setTimeout', 'scheduler.clearTimeout', 'options.maxTimerMilliseconds', 'options.replace for family/plugin only'],
    throwAt: 'every listed getter and proxy trap in turn', thrownValues: ['unique object', 'undefined', 0, 'string'],
  }, ['each required property read exactly once in declared order', 'no scheduler method reads when scheduler undefined', 'first throw preserved by Object.is and no later reads', 'no enumeration or options-container mutation']),
  family('F05', 'provider snapshots and method receivers', ['api.json/snapshotAndReceiverRules'], {
    schedule: ['construct with getter-backed options and explicit scheduler', 'replace invoke, three scheduler methods, maximum and replace properties', 'run positive timeout using captured providers'],
  }, ['later replacements are not observed; configured scalar retained', 'scheduler methods receive original scheduler object as this', 'factory fallback invoke receives undefined this', 'context invoke receives exact context as this', 'no injected provider called during construction']),
  family('F06', 'context presence and single invoker dispatch', ['V32', 'api.json/runtimeInvokerSelection'], {
    variants: ['own callable', 'inherited callable', 'absent with fallback', 'absent without fallback', 'present undefined with fallback', 'present null with fallback', 'present false with fallback', 'present object with fallback', 'throwing has trap', 'throwing get trap'],
    args: ['0', 'literal-command', 'one', '--signal=TERM', '$(not-shell)', 'a b'],
  }, ['ordinary in check; only present property is read, exactly once', 'present callable wins; absent alone permits injected fallback', 'present undefined/nonfunction gives exact invoke-unavailable125 and zero dispatch', 'trap exact rejection, never125; no ambient/capability probe or fallback Shell', 'selected command and argv remain literal and exactly one dispatch occurs']),
  family('F07', 'profile identity and effect-free information', ['V01', 'V02', 'diagnostics.data'], {
    argv: [['--help'], ['--version'], ['--help', 'ignored']], blockedAccess: ['context.invoke', 'stdin iterator', 'scheduler methods', 'registerCleanup'],
  }, ['exact packet help/version bytes, stdout only, status0 after write resolves', 'no provider validation, clock, timer, child, controller, sentinel or cleanup at invocation', 'gated stdout prevents early return; stdout rejection preserved exactly', 'strings identify virtual-bash cooperative profile, not GNU or package version']),
  family('F08', 'leading options and fourteen fixed records', ['V03', 'V04', 'V07', 'V14', 'V15', 'V16', 'profile.json'], {
    missing: [[], ['--'], ['1']], invalid: [['--signalx', '1', 'ok'], ['--help=x'], ['--version=x'], ['-h']],
    unsupported: ['--preserve-status', '--preserve-status=x', '-pv', '--signal', '--signal=TERM', '-sTERM', '--kill-after', '--kill-after=1', '-k1s', '--foreground', '--foreground=x', '-f', '--verbose', '--verbose=x', '-v'],
    literal: [['1', '--signal', 'literal'], ['--', '1', '--help'], ['1', 'ok', '--kill-after=1']],
  }, ['only leading options parsed, first duration permanently ends option parsing', 'first short flag selects unsupported family, not general clustering', 'every fixed failure uses bound decoded bytes/status125 and no child admission', 'bad diagnostic sink rejects exactly; no unbounded token echo', 'information records plus invoker/timer records accounted in F06/F07/F20/F21; all14 labels covered']),
  family('F09', 'complete ASCII grammar before overflow', ['V05', 'V06', 'parser-bound.json/diagnosticOrder'], {
    table: 'NUMERIC.json grammar rows', route: ['--', '<token>', 'fixture-status', '7'], alsoWithoutCommand: true,
  }, ['invalid grammar always invalid-duration even if overflow already detected', 'valid overflow precedes missing-command; valid nonoverflowing duration alone yields missing-command', 'signs, Unicode digits, whitespace, exponent, hexadecimal and locale decimal rejected', 'no child, timer or clock after invalid/overflow duration']),
  family('F10', 'mathematical zero has no deadline machinery', ['V08', 'V11'], {
    tokens: ['0', '000', '0.', '.0', '0.000d', { prefix: '', repeat: '0', count: 65536, suffix: 'd' }], childStatuses: [0, 7, 124, 126, 127],
  }, ['signal own property omitted, not present undefined', 'no clock, timer, sentinel or deadline cleanup allocated', 'borrowed stream identities preserved and one literal dispatch', 'every validated child status preserved, including ordinary124']),
  family('F11', 'fraction carry, sticky and exactly one ceil', ['V09', 'V10', 'parser-bound.json/arithmeticBounds'], {
    table: 'NUMERIC.json ordinary and carry rows', observation: 'observe scheduled remaining duration through public command and controlled clock; never require a public parse function',
  }, ['exact development rational oracle agrees with observed milliseconds', 'positive tiny input never underflows tozero', 'scale first, ceil once; no per-digit/unit rounding', 'carry reaching unit multiplier is correctly added to integer contribution']),
  family('F12', 'MAX_SAFE boundary in every unit', ['V12', 'V13', 'V29'], {
    table: 'NUMERIC.json maximum rows', maxMilliseconds: '9007199254740991', schedule: ['start clock0', 'wake at expectedMilliseconds-1', 'expect next delay1', 'wake at expectedMilliseconds', 'release child cleanup'],
  }, ['boundary at MAX passes; next positive rational requiring MAX+1 gives exact duration-overflow125', 'every s/m/h/d unit boundary compared to integer rational oracle', 'no arbitrary24hour cap', 'huge duration uses bounded chunks, not a real huge wait']),
  family('F13', 'long zero and late fractional digits', ['V10', 'V11', 'parser-bound.json'], {
    table: 'NUMERIC.json long rows', admittedCodeUnits: [0, 1, 31, 4096, 65536], routes: ['trusted standalone preadmitted strings', 'separate Shell admission controls F15'],
  }, ['arbitrary high-order zeros do not falsely overflow', 'late fractional nonzero produces exact positive ceil', 'long grammar-invalid overflow remains invalid-duration', '65536 is a finite fixture size, never a proposed product token cap']),
  family('F14', 'single-pass bounded arithmetic proof', ['parser-bound-clarification-v1/README.md', 'parser-bound.json'], {
    n: 'existing duration UTF16 codeunits including suffix', maximumReads: 'n+1', lexicalTraversals: 1, direction: 'reverse', auxiliaryStorage: 'O(1)', fractionTemporaryMaximum: 863999999,
  }, ['inspect exact declared candidate parser; one reverse traversal plus at most one suffix probe', 'no input-sized copies, full-token regex prepass, BigInt digits, powers of10, expanded-duration loop or second lexical pass in product', 'checked Number arithmetic bounds I,p and d*M+c; invalid grammar scanning continues after overflow flag', 'no new counter, hidden token cap or abort-preemption promise', 'development BigInt oracle is separate and cannot certify product complexity by timing alone'], 'static-source-proof-plus-instrumentation-binding-if-needed'),
  family('F15', 'existing Shell admission and shared accounting', ['V31', 'parser-bound.json/existingConstraintPolicy'], {
    limits: { maxSourceBytes: 128, maxExpansionBytes: 64, maxExpansionFields: 4, maxCommands: 1, maxSubstitutionDepth: 1, maxOutputBytes: 3 },
    routes: ['source exceeds128 before parse', 'expanded word exceeds64 before command handler', 'field expansion exceeds4', 'timeout plus child exceeds one command', 'recursive literal invoke exceeds shared depth', 'child writes four bytes under shared output3'],
  }, ['each route uses the actual accepted Shell/invoke seam, with matching untightened positive baseline', 'designated ShellLimitError.limit, not wrapper125 or unrelated missing command, proves activation', 'no counter reset, new Budget, duplicate duration charge or source reconstruction', 'separate caller-owned literal string admission qualification; output budget does not bound parser work'], 'actual-Shell-seam'),
  family('F16', 'cleanup enrollment before acquisition', ['V22', 'api.json', 'profile.json/timer'], {
    args: ['.001', 'fixture-block'], schedule: ['observe registerCleanup', 'first now', 'first arm', 'child admission'], registrationFailure: ['unique Error', 'undefined', 0],
  }, ['one idempotent retirement callback registered synchronously before all resource admission', 'registration throw exact and zero clock/arm/child', 'absent optional hook still finally awaits retirement', 'context callback/command finally overlap shares completion']),
  family('F17', 'monotonic chunking and late wake', ['V29', 'profile.json/timer'], {
    maximum: [1, 7, 2147483647], scenarios: ['duration20ms with max7, samples0/3/10/20', 'MAX duration with max2147483647 and late wake', 'fractional clock samples0/0.25/1', 'samples-MAX then MAX', 'stalled clock three wakes then controlled child return'],
  }, ['at most one live opaque handle; each arm integer1..configuredMaximum', 'subtract elapsed from remaining, not overflow-prone absolute deadline addition', 'late expiry before rearm; fresh sample each wake', 'stalled conforming clock may rearm; no added event-count limit', 'record fired-handle offers and clears separately; pending-handle retirement counts asserted in F18/F19']),
  family('F18', 'falsy handles are owned', ['profile.json/timer'], {
    handles: ['undefined', 'null', 0, false, ''], schedule: ['arm positive timer', 'child returns7 before wake', 'registered retirement overlaps finally'],
  }, ['each returned pending handle cleared exactly once by Object.is, including undefined', 'no truthiness ownership test; no stale callback rearm after retirement', 'handler result7 only after retirement', 'zero outstanding scheduler resources']),
  family('F19', 'reentrant retirement and stale callback', ['V30', 'profile.json/timer'], {
    scenarios: ['clearTimeout synchronously offers already-queued callback', 'callback queued before child returns but delivered after clear', 'clear invokes saved registered cleanup again'],
  }, ['callback/rearm admission closes before clearTimeout call', 'no clock read, arm, child abort or retroactive124 after closure', 'shared idempotent retirement completion; one pending-handle clear', 'trusted queued callback is offered at most once, never a repeated-callback guarantee']),
  family('F20', 'owned scheduler setup failures', ['V28', 'diagnostics.data/timer-setup-failed'], {
    now: ['throws unique object', 'undefined', 'NaN', 'Infinity', '-Infinity', 'MAX+1', '-MAX-1', 'string'], arm: ['throws unique Error'],
  }, ['before child admission exact timer-setup-failed stderr/status125 after local retirement', 'zero child admissions, no hidden fallback scheduler', 'valid negative and fractional bounded samples have positive controls', 'diagnostic write failure and retirement failure remain exact failures, not125']),
  family('F21', 'post-admission clock or rearm failure', ['V28', 'profile.json/timer'], {
    scenarios: ['now throws after first arm', 'rollback sample', 'nonfinite next sample', 'rearm throws'], schedule: ['child pending', 'wake activates failure', 'keep cleanup blocked', 'release cleanup'],
  }, ['child receives distinct private timer-failure reason, not own deadline sentinel', 'wrapper remains pending until child closure', 'only exact selected timer-failure rejection maps to fixed125 after successful retirement', 'nonconforming ignored signal is not fabricated125']),
  family('F22', 'early status and resolver preservation', ['V17', 'V18', 'V19', 'V20'], {
    statuses: [0, 7, 124, 125, 126, 127, 255], routes: ['trusted direct validated status', 'actual Shell unknown command', 'actual Shell VFS unsupported/inaccessible executable'],
  }, ['valid child status unchanged; status124 alone does not establish deadline', 'positive timer retired before handler result; child admitted once', 'resolver owns126/127 diagnostics, wrapper adds none', 'actual Shell resolver controls must activate designated error, not unrelated setup'], 'direct-and-actual-Shell'),
  family('F23', 'deadline spans selected child cleanup', ['V22'], {
    schedule: ['child work completes but cleanup latch stays held', 'deadline fires during cleanup', 'verify no wrapper settlement', 'release child cleanup', 'retire timer'],
  }, ['timer remains active through child cooperative closure', 'exact own sentinel yields124 only after selected child closure and retirement', 'outer/root-only cleanup is separately awaited outside this child deadline', 'no elapsed sleep used as correctness oracle']),
  family('F24', 'foreign and escaping failures beat name matching', ['V23', 'V25'], {
    reasons: ['distinct object with same name/message/code as deadline', 'AbortError-shaped object', 'ordinary Error', 'undefined', null, false, 0, 'string'],
    schedule: ['child escaping failure selected', 'deadline fires during held cleanup', 'release cleanup'],
  }, ['exact selected foreign failure rethrown by Object.is after closure', 'never infer ownership from truthiness/name/code/description', 'no124/125 masking of escaping execution/control failure']),
  family('F25', 'deadline and timer-failure ownership isolation', ['V23', 'V28'], {
    scenarios: ['two concurrent timeout commands', 'nested timeouts', 'foreign observed signal.reason rejected by sibling', 'timer-failure reason contrasted with deadline reason'],
  }, ['fresh distinct private reason objects per invocation and per reason class', 'only exact local selected reason maps to124 or125', 'closing one timeout does not abort caller or sibling', 'nested ordinary124 remains a status, not an inferred parent deadline']),
  family('F26', 'retirement and child cleanup failure precedence', ['V26', 'V27'], {
    scenarios: ['child0 plus clear failure', 'own deadline plus child cleanup failure', 'escaping child failure plus clear failure', 'retirement only without registerCleanup'],
  }, ['cleanup-only failure surfaces exactly or through accepted root aggregation, not124 or wrapper125', 'actual escaping child failure remains primary; retirement rejection still observed', 'registered failure barrier never silently drops retirement failure', 'pending cleanup resources close once; no unhandled rejection'], 'direct-and-actual-Shell'),
  family('F27', 'ancestor cancellation priority', ['V24', 'accepted Stage2 scoped review'], {
    rootReasons: ['unique object', 'undefined', null, false, 0, 'string'], schedule: ['own deadline fires', 'child cleanup remains held', 'root caller aborts', 'release closure'],
  }, ['accepted Stage2 caller signal.reason wins by exact identity after closure, including falsy reasons; abort(undefined) uses its actual default reason, not literal undefined', 'wrapper may not convert ancestor cancellation to124 or125', 'pre-aborted caller admits no child/timer', 'no whole-caller abort is used to make own timeout pass'], 'actual-Shell-seam'),
  family('F28', 'execution/dispose overlap and resource reaping', ['profile.json/timer', 'accepted Stage2 scoped review'], {
    schedule: ['child admitted', 'save registered cleanup', 'begin explicit caller cancellation and Shell.dispose', 'invoke saved cleanup overlapping finally', 'hold then release child cleanup'],
  }, ['actual exec and disposal remain pending until cooperative resource retirement', 'same idempotent close completion, no double clear/release', 'exact caller/cleanup precedence retained; all promise rejections observed', 'watchdog is failure only; record actual cleanup and all supervisor children'], 'actual-Shell-seam'),
  family('F29', 'nested deadline and outer-root cleanup boundary', ['V22', 'V31', 'profile.json/timer'], {
    schedule: ['outer timeout starts child inner timeout', 'inner returns ordinary124 before outerdeadline', 'hold only outer/root registered cleanup', 'observe child timer alreadyretired', 'release rootcleanup'],
  }, ['ordinary inner124 passed through without outer sentinel inference', 'root-only cleanup not retroactively inside completed child deadline', 'root still awaits registered cleanup; shared command/depth counts retained', 'no extra invocation or captured stream replay']),
  family('F30', 'binary stream identity and backpressure', ['V21', 'profile.json/invoke'], {
    chunksHex: ['00ff0a', '616200', 'fe80'], reusedProducerBuffer: true, stdinIsDefault: ['absent', false, true], childArgv: ['--literal', 'a b', '$(x)'],
    gates: ['first child read', 'stdout write', 'stderr write', 'selected child cleanup'],
  }, ['exact stdin/stdout/stderr object identities passed; stdinIsDefault omitted when undefined and exact when defined', 'wrapper never iterates, buffers, captures, closes or returns borrowed streams', 'literal argv preserved; cwd/env/replaceEnv overrides absent', 'owned downstream captures exact binary bytes before producer reuse, write backpressure preserved', 'actual Shell seam exercises shared output/depth budgets separately from trusted direct identity probe'], 'direct-and-actual-Shell'),
  family('F31', 'plugin capture collision and replacement', ['api.json/factories'], {
    scenarios: ['sentinel timeout already registered; defaultfalse', 'same with replacefalse', 'same with replacetrue', 'mutate options and scheduler after plugin creation before setup'],
  }, ['default/false setup preflights and registers nothing on collision', 'existing setup exception preserved, never command125', 'true registers exactly captured timeout through existing replacement path', 'options mutation after construction cannot alter capture', 'no aggregate/public default registration authorized by this module freeze'], 'actual-CommandRegistry-plugin-seam'),
  family('F32', 'explicit nonconforming and opaque boundary', ['V33', 'profile.json/timer'], {
    schedule: ['trusted custom invoker ignores signal', 'deadline fires', 'bounded fixture observes unsettled command', 'explicitly release invoker with7', 'await retirement'],
  }, ['permitted result7 retained; no fabricated124 or universal bound', 'no second dispatch, fallback Shell, native process, OS signal or forcedpreemption', 'no helper abort is relabeled product resourceclosure', 'fixture finally releases deliberately opaque work; actual supervisor settlement recorded'], 'qualification-not-termination-guarantee'),
]);
