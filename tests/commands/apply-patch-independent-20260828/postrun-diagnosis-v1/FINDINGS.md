# Apply-patch postrun diagnosis v1 — SOURCE/DATA only

## Disposition and authority

2026-08-28. Delegated investigator owns only this new subtree. Product, frozen
fixtures and historical evidence are read-only. No product execution, import,
build, compiler, native oracle, network, acceptance, rescore or retry occurred.
Preserve root authority `42e2529034a1a39d7c23945c3bfb22b228df180f`: **consumed HOLD,
27/70 jobs; 43 unrun; all-owned peak >=3 violation**. Exact all-owned peak was
not measured. The moved-types `EEXIST` is a separate frozen-controller setup
failure; the operator administrative Node -> Git overlap is a separate process
envelope violation. Neither is a product failure or waived by this diagnosis.

Counts remain source **115/4/6/1**, installed **115/4/6/1**, moved **116/3/6/1**
(PASS/FAIL/NOT_RUN/STATIC_NONCONFORMANCE); observed **346/11/18/3 of 378**;
all frozen obligations **346/11/62/3 of 422**. This report explains failures;
it does not convert any FAIL, STATIC_NONCONFORMANCE or NOT_RUN into a pass.

## Frozen identity and citation convention

Evidence root `E` is
`tests/commands/apply-patch-independent-20260828/capture-membership-v3/future-v3/`.
Matrix root `M` is its sibling `../matrix/`. `A:path:line` means that exact
UTF-8 source file in `E/evidence/work-archive.json.gz.base64`, decoded as data,
not the live checkout. Archive entries have prefix `source/` unless stated.
No extracted JavaScript is executed or imported.

- Candidate: `58be2d6c5706f3e90f01d48e695ecfd9daa52669`.
- Author evidence: `767b6729d3acac0dd17c42dfb9e0b93e6e9c4de5`.
- Compressed archive SHA256:
  `95d29ab19d665ff0816a7d8703656fcb8fcb8f5e769cc66caf9e5727ea9ff69c`.
- FINAL SHA256: `0f9cc57ffe3865f133846f0f82d88a2ac5b52dc1ecd06f37a61d4d50544e9e04`.
- Capture membership SHA256:
  `74a5aeb0c16922f9e96a98a1fe71125b1e4ade52a95a725486f244568b071098`.
- Worker SHA256: `6563b3319cb495dea5c0b5c0499d166eaf5bf63806fd9e12487ed42b6f046296`.
- Supplement SHA256: `44074ff7627215afdc92dd4565c2154ca3eb5b34870dafc0cae0433f912ed558`.
- Original32 SHA256: `b10cd0aeb7272ddb029baaa871b58f73ef645278e5bc3d9ef9bea1a1d1d6fe29`.
- Postbuild source inventory SHA256:
  `23b81ceaf2c59e9b3b0f3d9bdac008cc095feb430a4f3753f8a0c545c1d23c3b`.
  This is the 1243-entry source tree including dist, not prebuild sourceBefore.

`BINDINGS.json` records exact source and raw-record identities and fixture line
numbers. `DATA-VALIDATION.md` records the completed DATA validation and limits.

Initial DATA validation authenticated all 207 RESULT-SEAL file bindings, all
199 membership joins, all 2078 archived file bodies, and 378 case records from
nine captured product stdout streams. Fragment decoded lengths, offsets and
SHA256s and whole-channel SHA256s were checked. The six candidate module
files additionally match FINAL.sourceInputs lengths, SHA256s and Git blob IDs.
Supplementary binding detail is supplied in this subtree; no product output is
regenerated. Seal/hash matching is integrity evidence, not independent execution.

All five target IDs are in each layout's supplement-b stdout:
`E/evidence/011-source-supplement-b.json`,
`E/evidence/019-installed-supplement-b.json`, and
`E/evidence/027-moved-supplement-b.json`. Each receipt lists the exact three
stdout fragment files, ordered by offsets 0, 65536, 131072. Reconstruct the byte
stream before splitting JSONL; records can cross fragment boundaries.

## S62 — diagnostic expectation mismatch, not demonstrated over-allocation

Frozen fixture `M/SUPPLEMENT-v1.json:3998`, case S62, injects EACCES at access with
path `/work/a` and a message of 20,000 `é` characters (40,000 UTF-8 bytes).
Expected: return 1; unchanged `old\n`; empty stdout; permission-denial meaning;
stderr at most 16384 bytes and ending ` [truncated]\n`.

Actual, all layouts: return 1, unchanged namespace/bytes, empty stdout, exactly
`apply_patch: permission denied: /work/a\n` (38 bytes). The **only failed check**
is the truncation suffix (`E/worker.mjs:269`).

Source cause: `A:src/commands/apply-patch/shared.ts:128` uses
`descriptions[error.error.code] ... error.path` for FileFailure, not the provider
message. EACCES maps to `permission denied` at line 123. The injected huge
message is constructed by the fixture (`E/worker.mjs:134`), but discarded from
the command's rendered diagnostic. The short result does not need truncation.

Classification: **fixture diagnostic-policy assumption / contract adjudication**.
This sample does not show the command constructing an unbounded provider-message
diagnostic. Nor does it prove general diagnostic preallocation safety: line 128
constructs `detail` before line 136 caps emitted characters, and PatchError
messages can already have been constructed elsewhere. Keep that separate source
concern separate from this short-path EACCES result.

Minimal next author action: Poincare should document whether typed errors must
preserve the provider message or may render canonical errno/path meaning. If the
latter is intended, propose a separately versioned long *rendered* diagnostic
fixture, rather than adding a misleading truncation suffix to a short message.
Do not edit this fixture, relax frozen assertions, or claim this failure passed.

## S64 — root Shell stdin acquisition precedes literal-command dispatch

Frozen S64 (`M/SUPPLEMENT-v1.json:4140`) passes one literal patch argument adding
the POSIX name ``/work/$HOME`whoami`\a`` with the literal 16-byte payload `$(touch escape)\n`,
through actual Shell parent `context.invoke`, `replaceEnv:true`, HOME
`/not-expanded`. Expected: return 0, a 56-byte success summary, that exact file,
no `/work/escape`, and zero acquisitions of a THROW_IF_ACQUIRED stdin.

Actual, all layouts: rejection, exitCode null, reasonType `object`, empty
stdout/stderr, zero filesystem calls, acquired=1, pulls=0, returns=0,
cleanups=0. Namespace unchanged. Failed labels: outcome, stdout, complete
namespace/exact bytes, trace/safety. The raw record does not preserve the thrown
object's name/message/stack; do not claim raw reason identity was captured.

The fixture supplies the same throwing stdin to BOTH the parent root
`instance.exec(..., { stdin })` (`E/worker.mjs:234`) and child invoke (line 233).
Its iterator factory increments acquired then throws (lines 164–166).
Archived `A:src/shell/shell.ts:234` constructs ShellInput before dispatch;
`A:src/shell/input.ts:85` constructs InputCursor for a non-ShellInput source;
`A:src/shell/input.ts:16` immediately calls `source[Symbol.asyncIterator]()`. This
source chain explains the observed rejection before `apply_patch` can execute.
By contrast, the command's one-arg path at
`A:src/commands/apply-patch/apply.ts:34` returns the literal text without entering
the stdin loop at line 41.

Further source inspection finds the same eager wrapping in child replacement
input: `A:src/shell/runtime.ts:2251` constructs `new ShellInput(options.stdin, ...)`
before command dispatch at line 2265. Merely removing the throwing input from
root exec would move this failure to child setup, not fix the supplied child
no-acquisition expectation. This is source reasoning, not a second execution.
Line 2263 constructs quoted literal command words; the patch path checks at
`A:src/commands/apply-patch/parser.ts:34` do not reject the dollar/backtick/backslash
characters, but neither source observation substitutes for the unexercised result.

Classification: **fixture route confound exposing eager Shell-input
behavior at both root and child setup**; not evidence of special-character parsing, environment expansion,
or patch-command stdin consumption. A broad Shell no-unused-input-acquisition
guarantee, if required, would need a separate product fix and ownership decision.
The existing record does not exercise child literal invocation far enough to
decide those properties.

Minimal next author action: Poincare/root must decide ownership of the Shell
no-unused-input-acquisition guarantee. Lazy cursor acquisition is the focused
product candidate if that guarantee applies; preserve borrowed-input sharing,
cleanup and cancellation. Separately version a harmless-root/throwing-child
fixture to isolate the child boundary; it is not sufficient as a fix by itself.
Use harmless input in a distinct special-character-only case. No proposed change
is an accepted fix or retry grant.

## S71 — access is present; the observer dropped its mode

Frozen `M/SUPPLEMENT-v1.json:4524` expects delete denied, return 1, unchanged `old\n`, empty stdout, permission
denial `/work`; required trace `{method:"access",path:"/work",mode:2}` and no rm.
Actual, all layouts: these output/namespace outcomes match. The raw trace DOES
contain `{method:"access",path:"/work",occurrence:1,signalMatches:true}`.
The only failure is the required trace match; **the mode field is absent**, not
the access call.

`E/worker.mjs:121` constructs call records without args[1]; lines 122–124 add
write/read/mutation fields but never access mode. Line 287 compares every required
key, so missing mode cannot match 2. The denial hook at line 133 selects by path,
not access mode, and therefore the diagnostic alone cannot establish mode.
Independent source evidence does: `A:src/commands/apply-patch/apply.ts:136`
selects `dirname(file.path)` for delete, and line 88 calls
`this.context.fs.access(target, 2, { signal: this.context.signal })`.

Classification: **frozen trace instrumentation omission**. No missing-parent
authorization product bug is established. Minimal author action: version a new
observer recording access mode and, if it claims mode-specific injection, match
the provider denial on that mode. Keep the old failure and evidence unchanged;
do not globally loosen trace matching or diagnostic assertions.

## S74 — metadata-vs-byte branch, not moved-package correctness

Frozen `M/SUPPLEMENT-v1.json:4758` starts two independent MemoryFileSystem files with `old\n`,
omits identity fields, returns compareEntry `unknown`, and after the command's
write to one path writes the same payload directly to the other path
(`E/worker.mjs:140`, `:143`). This is a fixture-simulated alias effect, not proof
of deployed real hard links or real-provider alias semantics.

Expected in every layout: return 1, empty stdout, both paths `new\n`, command
writeFile(`/work/a`, flag `w`) present, command writeFile(`/work/b`) absent,
operation-2/prior-effects diagnostic. The worker additionally demands the literal
substring `target changed since preflight: /work/b` (`E/worker.mjs:28`, `:266`).

Actual source/installed: all effects and status match; the only failure is stderr
containing `target bytes changed since preflight: /work/b`. Moved: same effects
and status, but `target changed since preflight: /work/b`, hence frozen PASS.
Both include `apply_patch: operation 2; prior changes may remain: ` and newline.
Source/installed include a second readFile(`/work/b`); moved stops before it.

`A:src/commands/apply-patch/apply.ts:152` checks type/size/mode/mtime/ctime/known
distinct identity and emits `target changed` at line 154; only if that passes
does line 156 reread bytes and emit `target bytes changed`. The fixture removes
identity and changes four bytes to four bytes. MemoryFileSystem writeFile updates
mtime/ctime through `changed()` (`A:src/fs/memory/index.ts:298`, `:159`), which
uses Date.now(). Same-millisecond metadata can therefore leave the byte branch
to catch the mutation; a timestamp change can trigger the earlier branch.

Classification: **over-specific diagnostic predicate with scheduling-sensitive
metadata branch selection**. Source and call evidence strongly explain the split
without a package-layout bug. Raw traces omit returned stat fields and time
values, so exact timestamps and which metadata comparison differed are not
directly observed. Do not elevate an inferred timing mechanism into a captured
clock measurement or claim layout caused it.

Minimal next author action: separately version deterministic unchanged-metadata
and changed-metadata fixtures, recording stat observations and expecting the
appropriate distinct reason while preserving exact status, ordinal, bytes and
mutation trace checks. Decide the intended diagnostic policy explicitly; no
blanket relaxation, rescore or repeat of the consumed attempt.

## S54 — static checkpoint/preallocation concern only

Frozen S54 (`M/SUPPLEMENT-v1.json:3343`) requests abort(false) at the first interruptible yield after 4096
charged units, unchanged file containing 8192 `x` plus `\nold\n`, empty outputs
and original root reason identity. `E/worker.mjs:15` predeclares it static, and
line 76 returns STATIC_NONCONFORMANCE before fixture setup/invocation. Its three
raw records have a reason string but **no dynamic raw payload**. No abort timing,
resource peak, private counter value or successful cleanup was measured for S54.

The static concern is real in the source: Work.step adds a whole amount without
yield (`A:src/commands/apply-patch/shared.ts:42`); checkpoint only yields later,
then resets nextYield to units+4096 (line 48). `apply.ts:101` charges a whole file,
copies it at line 102, and checkpoints at line 103. For this fixture that file
is 8197 bytes; the source permits that bulk charge/copy between checkpoints.
Input chunk copying and consolidation similarly bulk-charge/copy before the
next checkpoint (`apply.ts:44`, `:52`); encoding charges/encodes/copies a whole
line before checkpoint (`matcher.ts:52`). These are static control-flow facts,
not proof of the exact dynamic first-yield endpoint or cancellation outcome.

Do not conflate fairness with absent caps: file-size/read limits are checked
before the owned file copy (`apply.ts:96`), input bytes before owned chunk copy
(`apply.ts:43`), staged output byte count before allocation (`matcher.ts:48`),
and maxWork before increment (`shared.ts:44`). Nevertheless whole-result
allocation (`apply.ts:50`, `matcher.ts:49`) and per-line temporary encoding
precede later checkpoints. Caps are not a measured memory bound, nor evidence
that every allocation has a corresponding pre-admission work charge.

Minimal candidate for Poincare: budget-aware bounded copy/encoding steps with
checkpoint opportunities before crossing the declared 4096-unit interval;
separately audit allocation admission and retained/temporary buffers. Obtain an
authorized, independently observable work-yield schedule before any dynamic
claim. Do not lower caps, expose private counters as a substitute for a public
contract, or mark this static receipt as a passing cancellation execution.
