# Stage2 getopts: D02/D03 code-reading handoff

2026-08-27. Design only; runtime ownership remains **RESERVED to Sagan**.
No release, implementation, registration, prototype, build, test, native run or
Stage2 acceptance is asserted. This leaf owns only these new stage2-design notes.
Independent Curie36 is not rerun. DU9a5a6f92 and O060 remain deferred.

## Authority and exact source binding

- Root's instructions in this assignment finalize D01/D02/D03; older proposals
  and frozen `pending` text are historical, not permission to override them.
- Private helper: `157d78c957b56f83f6e705fc35da60b1f2ea3a9b`, scoped independent
  acceptance `4f84fdfd41134710cdb68fab3f5970cb14e54da3` only.
- Stage2 freeze `51f14914a0e7de15c3a23961424f232853bf5c33`; evidence
  `592c864ef62f5a29b1f126c83b6ac532357fb599`, especially
  `tests/shell/getopts-independent-20260827/stage2/RESULT.md:1` and
  `CORRECTIONS.md:8`. Frozen baseline is d6814492, not today's runtime acceptance.
- `source-evidence.json` records exact live/eba/HEAD SHA256s, Git identities,
  scoped differences and frozen-input hashes. References below are to those
  bytes, not floating guarantees about later concurrent edits.
- All nine production paths changed by owned-output commit
  `eba049535d154f4e028f57ffd8efd7622b2239ca` were compared with current bytes.
  Runtime/shell also compared with that commit's parent: runtime +19/-3 lines,
  shell +7/-0. Preserve those callback wrappers, not the pre-eba implementation.
- Read/hash check: all 18 recorded source paths match eba, initial-read HEAD
  c4b6b3a0 and recording HEAD35909b63; both scoped eba diffs are empty. Ten
  frozen sidecar files match592c864e. This checks listed paths, not new-entry
  absence, whole-tree immutability or archive-gate acceptance.

## D01 retained verbatim in effect

Use existing checked scalar writes, **fail fast at the first readonly/name
failure**. Keep earlier scanner/OPTIND publications; no later writes or rollback.
Never remove readonly OPTARG's value or attribute. Failed external assignment,
export-with-value, read or prefix installation does **not** reset; notify only
after a successful store. Temporary same-scope prefix restoration restores the
exact saved visible binding and hidden state on success/failure/abort, not an
ordinary assignment reset. Preserve ordinary nonfailure Bash5.3 publication
ordering; identify failure-path differences explicitly.

The prefix rule also deliberately differs from frozen **nonfailing N04** and
historical REPORT.md:144/180: Bash5.3 resets on restoration; root now requires
saved-cursor restoration. Do not call N04 unchanged product equality. Failed
export reset in historical REPORT.md:143 and N14 is likewise superseded.

## D02: same Budget, exact cadence and failure boundary

**Existing access points, not invented APIs:**

| Source | Actual mechanism |
| --- | --- |
| `src/shell/shell.ts:87` | One `new Budget(resolveLimits(...), options.signal)` per public exec, not per builtin/function/invoke. |
| `src/shell/runtime.ts:51` | `Budget.commands/iterations/bytes/sourceBytes`, `signal`, `controller`, `fail`, `tick`, `loop`, `source`, `sink`. No expansion method, global work counter, timer/deadline counter or time-limit field. |
| `src/shell/types.ts:17` | Existing eight `ShellLimits` fields; timeouts arrive as caller AbortSignals, not a new getopts time API. |
| `src/shell/runtime.ts:433` | Normal `executeCommand` tick once; existing task yield every 128 commands, then signal check. Do not tick again inside getopts. |
| `src/shell/runtime.ts:958` | `command TARGET` already charges its nested dispatch; keep that extra normal charge. |
| `src/shell/runtime.ts:1473` | Nested invoke reuses `this.budget`; its literal simple command reaches the same execute/words path. Shebang target's own normal tick is at :1218. |
| `src/shell/runtime.ts:1722` | `words` checks accumulated field count using `budget.fail("maxExpansionFields")`. |
| `src/shell/runtime.ts:1915` | `word` checks UTF-8 bytes per expanded word (:1920), result bytes per word (:1979), and fields (:1971/:1983), not a cumulative execution-wide argument-byte pool. |

**Proposed private adapter cadence:** retain normal admission/expansion first.
For already-selected optspec/name and explicit argv or fallback positionals,
check actual existing limits using `budget.limits` and `budget.fail`; do not
re-expand strings, parse literal argv, charge source/output/commands for scanner
bytes, or call nonexistent `Budget.expansion/checkpoint/time` methods. Check
forwarded builtin operands including command against maxExpansionFields; check
the selected argument vector separately, not counted twice. Check each scalar
against maxExpansionBytes, not the sum of unrelated words. These checks also
cover positionals and middleware-supplied values that bypass ordinary expansion.
Check `this.signal` before admission and between bounded batches. A length
greater than the byte ceiling can reject before UTF-8 measurement; otherwise
measure the individual string. Yield every 128 admitted entries if needed.

Pass existing `GetoptsWork` (`src/shell/getopts.ts:6`) with `signal: this.signal`.
Propose `yieldEvery=128`: each checkpoint checks `this.signal`, awaits
`interruptible(new Promise(resolve => setImmediate(resolve)), this.signal)`,
then checks again. The final nonempty helper flush uses the same task yield,
even below 128 steps. A resolved Promise alone is not this task yield. No tick,
loop or global-work increment inside the checkpoint. Helper :102 checks abort
on every step; :120 observes pending checkpoint rejection; :181 flushes before
return. Timers/caller abort become observable at real task yields.

Concrete **private-cap proposal for owner ratification**, not a public limit or
frozen assertion: let B=maxExpansionBytes and A=selected argument count already
admitted within maxExpansionFields. Use maxArguments=maxExpansionFields,
maxBytes=saturating-safe-integer B*(A+1), maxSteps=saturating-safe-integer
2*B*(A+1)+A+2. Perform overflow-safe saturation, not rounded unchecked products.
These cover helper optspec+argument validation, second optspec pass, argument
steps and start/finish; they avoid falsely treating its aggregate BYTE_LIMIT as
the shell's per-word byte budget. The helper's per-call cap resets with ScanWork;
the shared Budget never resets. The bounds are algebraic code-reading deductions,
not performance measurements. A lower independent work ceiling, if desired,
needs an explicitly labeled private policy and separate evidence, not a hidden
maxCommands conversion. Numeric private tuning and explicit ASCII/input-refusal
diagnostic/status remain owner binding choices; no fixture values are invented.

**Ordered publication and exceptions:**

1. Early builtin operand/usage rejection or admission/helper failure: no scan
   publication. Preserve successful earlier script/prefix effects independently.
2. Await complete `scanGetopts`; check signal; publish returned hidden cursor.
3. If result.diagnostic is present, await diagnostic on existing context.stderr;
   then check signal. Colon silence or OPTERR suppression performs **zero parser
   diagnostic writes**, not a write of an empty buffer. Independent binding
   failures can still use the shell's existing failure diagnostic path.
4. Checked OPTIND publication, then checked OPTARG set/unset, then validate and
   checked-write destination. All are getopts-internal origins: no OPTIND reset,
   including destination=OPTIND. No await/yield is needed between scalar stores.
5. First checked failure stops. Throw the original error into existing mapping;
   no preflight of all destinations, no rollback, no second destination attempt.

A rejected/aborted awaited parser diagnostic leaves only the earlier hidden scan
committed; OPTIND/OPTARG/destination stay as at builtin entry (including prior
prefix installation). Failed/partial sink bytes and already-charged output are
not undone. Abort after the write but before publication is caught by the check;
an opaque late completion must never resume publishing.

`writeVariable` at runtime:297 checks readonly but does **not** validate names;
the existing scalar identifier check at :1597/:1617 must also guard the late
destination. Ordinary Error maps to status1, EPIPE to141, CommandFailure to its
status, ShellLimitError propagates, and caller cancellation preserves its reason
via :511 and shell:102. Thus “preserve identity/existing mapping” is not a promise
that arbitrary sink errors publicly reject Shell.exec unchanged: :523 may attempt
a shell failure diagnostic and :527 returns1. Do not catch shared-limit/sink/
checkpoint/caller errors as getopts usage2. Helper STEP_LIMIT is private work
failure, not a shared-budget event or permission to manufacture ShellLimitError.

**Owned output:** diagnostic `writeText` uses one awaited `ByteSink.write`
(`src/contracts/io.ts:136`). Keep `Budget.sink` runtime:85's same-budget WeakMap
deduplication and ownedOutput callback, `signalSink` :241's callback/signal
forwarding, shell:115's capture-before-external callbacks, and pipeline:351's
ownedOutput forwarding. Do not strip consumerClosed, replace callbacks with raw
writes, call both write routes, create another capture, or charge bytes manually.
No new getopts-owned acquisition is needed; existing scope/cleanup and invoke
finally paths still settle cooperative work, not opaque host promises.

## D03: visible child environment is not a new shell

`invokeScoped` runtime:1484 clones state, deletes **only previously exported**
child variables, installs validated env, replaces child.exported, and clears
child local frames at :1497. Merge is `{...context.env,...options.env,PWD:cwd}`;
replace is `{...options.env}`. Undefined values are invalid (:1489), not deletion
sentinels. A key omitted from merge options cannot remove a context export.
`env -u` computes an exact replacement map (execution.ts:59/:85).

The following table assumes transparent context.env initially equals the base
exported map, before later middleware. E means exported, U unexported, absent
means no visible scalar. v/w denote exact strings, not presumed integer values.
Hidden actions are the proposed D03 binding, not current implemented getopts.

| Base visible OPTIND | invoke options | Child visible / exported env OPTIND | Hidden reconciliation |
| --- | --- | --- | --- |
| E(v) | env omitted, merge `{}`, or merge without OPTIND | E(v) / v | Deep clone, no reset. |
| E(v) | merge or replace containing same v | E(v) / v | Deep clone, no reset despite new map/delete-reinstall. |
| E(v) | merge or replace containing w != v | E(w) / w | Synchronize child only from final effective binding. |
| E(v) | replaceEnv=true, env omitted/{} or excludes OPTIND | absent / absent | Child removal/reset; do not insert visible defaults. |
| U(v) | env omitted, merge without OPTIND, or replace missing OPTIND | U(v) / absent | Unexported binding survives; deep clone, no reset. |
| U(v) | merge or replace containing same v | E(v) / v | Export promotion only; no assignment/reset. |
| U(v) | merge or replace containing w != v | E(w) / w | Synchronize child only. |
| absent | omitted/merge/replace excluding OPTIND | absent / absent | Preserve cloned hidden state; do not infer fresh startup. |
| absent | merge/replace containing v | E(v) / v | Child binding installation/reconciliation. |

If forwarded context.env lacks a base export, even omitted merge options remove
that export from the child; compare **base effective visibility to final child
visibility**, not options.env alone or transient delete/reinstall. Removing
OPTIND from context.env cannot erase a base U(v) binding: it was never exported.
Replacing env still leaves other unexported variables/local visible values in
child.variables; it does not promote them, preserve local restore frames, or
expose them in CommandContext.env. No implicit PWD in replace mode. Base unexported
PWD can nevertheless remain a shell variable by the same rule. Supplied PWD does
not set cwd. Parent/siblings remain unchanged on every invoke settlement.

Deep-clone `GetoptsState.active` with existing `cloneGetoptsState` (:56), plus
private binding metadata and saved snapshots, at runtime:256; a state spread
alone aliases the cursor. Reconcile changed OPTIND only **after** complete child
env installation/validation. Same-value host forwarding (even v="1") is not a
script assignment. Actual successful `OPTIND=1` in script always resets. Use
`withGetoptsIndex` (:66) only after binding-aware conversion: <=1 resets; >1
retains active cursor. Removal clears the child binding's integer marker and
resets hidden state; unchanged absence is not a removal event.

Fresh initialization is different: shell:144/:148 and `processState` runtime:1034
are the two fresh state constructors. Future Stage2 initializes visible
OPTIND/OPTERR="1", preserving inherited export bits or leaving fresh defaults
unexported, and creates a fresh hidden cursor; it does not fabricate OPTARG.
**Current code has no such defaults/metadata**. Never run this initializer in
clone/invoke/shebangState. A later actual bash/sh interpreter initializes its own
state separately; that is not evidence of env replacement leaking defaults.

`dispatchScoped` :815 snapshots exported initialEnv; :840 compares values, not
object identity. Unchanged fresh forwarding is already a no-overlay case.
The actual middleware API mutates/replaces `context.env` (command.ts:30) and
awaits/returns zero-argument `next()` (plugin.ts:23/:43/:58); there is no
`next(replacementContext)` API. Literal child calls use `context.invoke` and
existing `CommandInvokeOptions`/`ShellInvokeOptions`, not a callback stub.
Changed middleware overlays act on that dispatch's active state; for invoke
this is the child, **not** a parent mutation channel. Direct dispatch is not
automatically a cloned child. Keep its existing visible overlay eligibility:
:903 restores only if the value still equals saved.overlay. Couple private
hidden/binding snapshots to that actual install/restore branch; do not silently
replace it with unconditional restoration or force every middleware dispatch
into a new shell. Restoration is a snapshot origin, not a new assignment.
Host env changes are host-policy reconciliation, not native assignment parity.

## Minimal released write-set and scalar-origin checklist

Only **src/shell/runtime.ts and src/shell/shell.ts** are needed production
integration candidates, both still reserved. No root exports, package changes,
new public options/types, helper rewrite, arithmetic engine or nonscalar expander
redesign. Private metadata, initializer and adapter may live in runtime; shell
uses the initializer. This is a handoff of edit sites, not permission to edit.

| Current sites | Required origin/capture treatment |
| --- | --- |
| runtime:297/:302; arithmetic.ts:189/:201 | Notify after successful checked write. The arithmetic fast path currently returns raw variables when no readonly set, so proxy-only readonly logic misses normal arithmetic writes; always intercept relevant OPTIND arithmetic stores without re-evaluating their already-computed number. Existing callers :451/:1739/:1801 include substring arithmetic side effects. |
| runtime:494/:1786; :1538/:1540 | For-loop and parameter `:=` already call writeVariable; cd writes fixed PWD/OLDPWD. Distinguish ordinary assignment from internal getopts stores. |
| runtime:744/:753/:754/:795 | Prefix/plain assignment bypasses writeVariable after its own readonly check. Save before first successful install; failed install creates no restore/reset. Preserve value presence, export/readonly/integer binding metadata and deep hidden cursor. In finally restore exact prefix snapshot on all settlements, without reset. No-command assignment persists. |
| runtime:761/:765/:773/:775; :1748 | Inline function-redirection scratch variables and redirectAssignments injection bypass setters. Preserve scratch state's independent metadata, restored saved binding and successful side effects; substitution child prefix installation is child-only. Do not shallow-share hidden metadata or copy saved values without their binding state. |
| runtime:840/:845/:846/:903 | Host overlay install/remove and conditional restore: effective-value reconciliation, not script same-value assignment; no hook on unchanged forwarding. Attach corresponding hidden snapshot only to actual restored bindings. |
| runtime:853/:858/:864/:870 | Snapshot hidden cursor at **function entry**, before body; retain normal shared execution. Restore entry cursor iff successful local OPTIND actually created the frame; restore visible binding with its saved attributes. No per-function Budget. Rejected local creates no restore trigger. |
| runtime:1603/:1605/:1607 | local/export/readonly value writes bypass setter. Hook only successful value store; bare export/readonly do not reset. Fresh unvalued local removes visible/integer binding. Repeated local must retain original entry snapshot; N05 corrected repeated-bare-local reset requires separate handling even though current `locals.has` skips creation. It is not a universal bare-declaration reset. |
| runtime:1620/:1621 | Successful unset removes value/export, clears private OPTIND integer binding and resets; failed readonly unset changes none. Internal getopts OPTARG unset must check readonly, not use unchecked delete. |
| runtime:1672/:1692/:1698 | read REPLY and named fields bypass setter after checks; notify for each successful relevant field, never the failed field. A nonzero read status can follow a successful store (EOF), so command status alone is not hook success. |
| runtime:256/:1157/:1484; shell:144; runtime:1036 | Clone/shebang/invoke bulk copy or delete/reinstall is not a series of script assignments. Deep-copy hidden metadata; reconcile effective child env once. Fresh constructors alone initialize defaults. |

Function snapshots must be captured even before a later `local OPTIND` occurs;
local OPTARG/OPTERR alone does not restore the scanner. Existing `assignments`
map consumption at :1610 and special-builtin clearing at :882 decide whether
prefix binding persists; extend their snapshot payload rather than ignoring
those ownership transitions. Source's positional save/restore :1453/:1463,
set/shift, groups and eval do not themselves reset the scanner. Clone boundaries
include pipelines :366, subshells :455 and substitutions :1745.

The historical integer-binding/signed-index profile is documented in archived
REPORT.md:128/130/131/156/194; helper numeric APIs do not implement it. Private
OPTIND binding metadata must distinguish fresh integer binding from unset/local
plain text and be captured with restoration. Do not infer a new generic variable
attribute API or execute result-name syntax. All scalar names still use the
current ASCII identifier grammar and null-prototype variables.

## Frozen-input mapping and explicit limits

| Frozen IDs | Handoff use, not candidate passes |
| --- | --- |
| N01/N02, I01/I02 | Regular builtin routing and fresh defaults versus inherited exports; no builtin dispatcher/declare/typeset addition. |
| N03/N10, I03 | Successful origins, alias publications and integer-binding distinction. |
| N04, I03 | Preserve native prefix reset capture; root exact prefix snapshot restoration is now a labeled divergence. |
| N05/N06/N09/N15, I04 | Function-entry snapshot, dynamic locals, no set/shift reset; N05 original repeated-local expectation remains wrong. N15 readonly endpoint follows D01, not native-success status. |
| N07/N08, I04/I10 | Clones isolate; group/source/eval share. Host env table is code/contract policy, not native evidence. |
| N11/N12/N13/N14, I05/I12 | Late names, readonly fail-fast, no failed-setter reset; preserve stronger OPTARG protection and native status differences. |
| N16, I06/I09 | Diagnostic/silence behavior; no native sink-failure claim. ASCII refusal differs from native byte options. |
| I07/I08/I09/I10/I11/I12 | Future actual host budget/cancellation/sink/literal invoke/no-IO/publication cases; definitions only, no execution here. |

Frozen evidence remains 16 scripts and 12 host invariants (host executions0).
Original Darwin Bash5.3 expectations matched14/16, N05/N13 corrections retained;
Bash3.2 remains separate9/16, not retroactively corrected or Linux evidence.
Current source has no registered getopts. This handoff performed only reads,
hash/diff checks and new documentation creation. No canonical tests, held fixture
rewrites, public-consumer proof, runtime acceptance or superiority claim. Stop
after mapping handoff; root must separately release runtime ownership and bind
future executable host controls, retaining these intentional policy differences.
