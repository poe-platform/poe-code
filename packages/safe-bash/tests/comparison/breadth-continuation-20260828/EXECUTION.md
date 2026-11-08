# Proposed bounded execution contract (not an executor)

## Admission before semantic execution

1. Different reviewer freezes this packet and a versioned executor. Authenticate
   every recipe, tool binary, adapter, supervisor, loader hook, dependency file and
   candidate input before running it. Bind exact modes/hashes/paths, reject unsafe
   paths, unknown entries and symlinks in fresh views; authorized tool aliases may
   be metadata-only with their regular targets bound. Never copy/read AGENTS for
   proof. No whole-Git-history or live-tree census. Protected packet files and
   materialized views need pre/post and new-entry guards.
2. Admit the exact67eab public package hash and its complete member manifest.
   Authenticate a complete selected committed build closure if rebuilding. Exact
   whole-pack reproduction and a bound prior reproduction are different claims;
   either choice must be declared in the later seal. No present-day root dist,
   concurrent modules, source imports or build omissions (README/metadata included).
   Root acceptance of public78 is a prerequisite, not newly rerun by this cohort.
3. Comparator archive SHA is in BINDINGS.json. Reuse its previously qualified
   offline staging/lock/dependency/adapter recipe only after exact authentication.
   The old archive receipt is not proof of currently available bytes. If any
   required file is unavailable, HOLD the head-to-head portion; do not install,
   download, substitute a version, reconstruct missing bytes or call target-only
   results comparative. Admission work itself needs separate execution authority.
4. Use isolated installed target and physically moved consumer/package layouts;
   deny old package/source paths in moved resolution. Comparator has one isolated
   installed layout: no comparator portability claim. Actual ESM load receipts
   must show parent URL, resolved URL, executed-byte hash and package binding, not
   merely hashes of files that might have loaded. Bind CJS/worker/WASM assets if
   the admitted comparator actually uses them. Denied source resolution must
   occur before any fallback module loads. Unsupported tracing is a HOLD.
5. Preserve raw target stdoutBytes/stderrBytes. Authenticate the baseline's exact
   existing byte API/adapter before using binary W03. Its old stderr was a UTF-8
   encoding of exposed text, not independently captured raw stderr. Label this
   boundary; do not claim stronger byte equivalence. No decoding/trimming, sorting
   captured output, diagnostic category broadening, native processes, external
   network, credentials or optional engines. No XAN import/test or new recipe.

## Fixture and oracle boundaries

Legacy recipes keep every script/effectiveScript, cwd, env override, stdin byte,
file mode/content, directory, symlink, target argv, expectation and30-second budget.
Base virtual environment/configuration is copied from authenticated old profiles
in BINDINGS.json. Adapter internals must be requalified, not assumed identical.
No synthetic /usr/bin/echo file, provider allocation, tree charset flag or patched
HTML matcher may be added. Initialize only declared fixture inputs and original
adapter scaffolding, identifying that scaffolding separately from product effects.
Apply the original preserveInputs/effect predicate exactly; extra instrumentation
is descriptive, not a silent stronger legacy oracle. Operational credit also
requires genuine target admission, natural completion and all historical profile
qualifications. In particular, no-op/stub success is not workflow completion.

New W01–W10 use Memory VFS, literal UTF-8/base64, explicit virtual cwd/env and a
fresh shell per case. No host-file-backed fixture semantics. All expected outputs
and namespaces are independent literals. Preserve every initial file's bytes and
permission bits; assert the exact added paths and absent paths specified. Extra
entries fail. Ignore timestamps/inodes and mask file type bits when comparing
permission bits; no all-stat purity assertion. New file modes are recorded but
not compared across engines (different creation defaults already qualified).
The W07 lookup must use real Memory access(X_OK), not registry-name substitution.
W06 is explicitly apparent bytes, never physical allocation/parity credit for oldDU.

After `agentCommands` admission, require the independently frozen78 names before
measured dispatch. Use a final harness-only plugin with `setup(host)` recording
the completed preceding registration barrier and a captured promise; it registers
zero commands. Await that actual barrier, not `await shell.use(...)`, a sleep or
an arbitrary sync object. Bound failure before barrier too. Record plugin setup
separately; it is zero extra Shell.exec calls. Future adapter may not silently
replace this with benign execution or reset counters to hide setup. Check setup
failure propagation and pending admission with control C11.

## Schedule and finite limits

- One attempt, stable order: 23 legacy rows in original order then W01–W10;
  for each row: target-installed, baseline-installed, target-moved. 99 maximum
  semantic invocations. A fresh supervised child/fixture per invocation; serial
  scheduling, no batching/retries or target-output-trained baseline expectations.
- Twelve separately identified controls, at most one positive and one negative
  child per control (24 additional maximum; in-memory comparator perturbations
  may use fewer). Max123 supervised children total; one active child at a time.
  Build/admission tools are counted separately in the later seal, not hidden here.
- Legacy limits: original target4MiB output/100 commands/100 loop iterations/
   4096 pipe high water; baseline exact profile in BINDINGS.json. No tightening
   of old semantic limits.30s natural deadline per child +2s cooperative cleanup
   and1s forced-reap escalation. Forced termination is a lifecycle failure even
   if output matched. Stop the cohort if cleanup or binding cannot be established.
- New workflows: target limits `maxOutputBytes:65536`, `maxCommands:32`,
  `maxLoopIterations:16`, `maxSubstitutionDepth:4`, `maxSourceBytes:8192`,
  `maxExpansionFields:256`, `maxExpansionBytes:65536`, `pipeHighWaterMark:1024`.
  Baseline shared declared knobs: `maxExecutionTimeMs:30000`,
  `maxOutputSize:65536`, `maxInputBytes:65536`, `maxCommandCount:32`,
  `maxLoopIterations:16`. Different knob sets are not equivalent work budgets.
- New input <=64KiB total, source <=8KiB, <=32 fixture entries, <=64 final entries,
  <=64KiB final payload; each capture capped at64KiB. Legacy combined capture
  supervisor cap8MiB (not a replacement for original engine4MiB output budget).
  Metadata <=256KiB/child; aggregate raw archive <=256MiB. Retain bounded prefixes
  and exact counters if a cap fails; never silently truncate then pass. Outer
  75-minute guard covers123×33s plus bookkeeping; not a performance measurement.

## Outcome and resource policy

Capture status or full thrown error, stdout/stderr bytes, dispatch and stdin
acquire/next/return counts, created files, loaded code and cleanup events BEFORE
assertions. Sources/sinks must preserve backpressure/owned bytes, not prebuffer
everything to simulate streaming. Normal EOF need not call return; record the
actual boundary. Each case awaits shell disposal, borrowed-stream settlement,
all scheduled timers and tracked I/O, child exit AND stdio close, and process-group
absence. Do not force exit to produce success or close unrelated resources.
On ordinary assertion failure continue only after natural reap and intact guards.
On resource/admission failure stop and enumerate the unrun tail exactly; no retry.
Control-induced failures are separate expected rejects, never positive passes.

Report 23-case unchanged subset outcomes, 10 new workflow outcomes and target
layout results independently. Keep an all54 eligibility table, the unselected31,
all controls, missing proofs and future gates. Do not add new outcomes to old13/54
or47/54; no composite improvement percentage or superiority claim. Record clocks
only for lifecycle guards and unchanged sleep semantics, not throughput/RSS ranks.
