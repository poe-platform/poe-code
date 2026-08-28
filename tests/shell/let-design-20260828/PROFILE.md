# Proposed LET builtin profile — root decision required, no implementation

## Authority and chronology

This is a pre-LET-code design after inspecting the existing arithmetic/runtime.
The baseline is `5137a74ec855a32d8a8860eb66b62eb44d11e290`, with **only**
`src/shell/runtime.ts` from accepted CD
`4641075df5355a91c83bf5b2cc3a88dfaf1f5153`. `BINDINGS.json` authenticates
all 13 shell files; the other 12 are byte-identical at those commits. The full
CD commit also contains unrelated timeout/XAN/WebDAV/public changes: none are
part of this selected composition. CD's root acceptance via `192ab78b` retains
its L24 Memory-component qualification; no CD proof is rerun or rescored here.

The native recipe was committed at `cd1926ba` before any Bash execution.
An initial **supervisor syntax-check failure**, before native execution, and
the obsolete unexecuted manifest are retained. `MANIFEST-V2.json`, SHA256
`f47b59eee0c8072334788bed76bb969969a4a2e4ca5d1e21c6686c9df9483d10`, binds
the corrected supervisor, unchanged 28 scripts and retained preparation files.
The obsolete manifest does not authenticate the corrected supervisor bytes.

One run on 2026-08-28, 06:57:12.824–06:57:13.350 UTC: **28 observations,
28 naturally closed child groups, 0 unexecuted, 3,558 captured bytes**.
The script-level exit histogram is 27 zero / 1 one; it is NOT 27/28 passing LET
expressions. Rows print each intermediate LET status. N20 intentionally ends
with status 1 under errexit. PRE/POST tool/recipe guards passed, HOME/TMPDIR
stayed empty, and every recorded PID/group was absent after close. No forced
termination, product execution, private access, network or async-abort native
test occurred. N00 establishes actual GNU Bash **5.3.0(1)-release**, platform
`aarch64-apple-darwin25.4.0`; binary SHA256 is the exact root pin `8cecb482…673c`.

## Minimal production surface

**Only proposed production write path: `src/shell/runtime.ts`.**

1. Add `let` to `shellBuiltinNames` (line 39), automatically entering
   `implementedBuiltins` (44). Do NOT add it to `specialBuiltinNames` (45).
2. Add a narrow private LET handler and a branch in `builtin` (2204), adjacent
   to the existing `getopts` branch. Reuse `prepareArithmetic`,
   `evaluateArithmetic`, `arithmeticVariables`, `writeVariable`, current
   `budget`, signal, diagnostics, dispatch and scope closure.
3. No arithmetic/parser/lexer/getopts/cancellation/cleanup/types changes;
   no plugin registration, default-command count change, root/subpath export,
   dependency, host eval, native execution, new Budget or standalone engine.
4. Future product tests/docs are separate from this design-only directory.
   Poincare owns the runtime window. Root must approve choices below and
   release ownership before implementation; subsequent stack work requires
   explicit composed runtime binding, never copying this older whole runtime.

All runtime line numbers here refer to the pinned CD blob, not moving HEAD.

## Recommended semantics (not yet ratified)

- Ordinary stateful builtin: a function named `let` wins; `command let`
  bypasses the function; `type let` reports the builtin. Existing middleware
  and command admission still apply. Do not silently allow a registered plugin
  named `let` to replace the builtin (`internalDiscovery`, 1494).
- Optional **one leading `--`** terminates the small builtin preamble. Remaining
  arguments are separate arithmetic expressions, never joined into source and
  never reparsed as shell words. `-1`, `-name`, `--name`, `++name` remain arithmetic
  operands, not generic invalid options. Special `--help` is decision C3 below.
- Process expressions left-to-right, preparing and evaluating **one argument
  at a time**. Stop on the first error; preserve earlier successful writes.
  Do not preparse every argument, and do not roll back the whole command.
- Return 1 if the final expression is zero, otherwise 0. A zero earlier
  expression does not stop evaluation. No arguments (also lone leading `--`):
  status 1 and `let: expression expected` through the normal shell diagnostic
  envelope. Explicit empty/whitespace argument: zero, status 1, no diagnostic.
- All successful assignments/increments use the existing checked write proxy.
  `OPTIND` stores retain arithmetic origin and reset the existing cursor once;
  no coercing an already evaluated result again, unchecked deletion or readonly
  attribute removal. Assignment evaluates its RHS before the checked target
  write, so a readonly error does NOT imply atomicity or suppression of RHS
  side effects. No preflight of all lvalues.
- Native-looking ordinary arithmetic errors can use the existing evaluator's
  message with a `let:` command label and the current Shell envelope. Exact
  GNU diagnostics are NOT the profile: invalid-base text and readonly label
  placement already differ. Never blanket-convert cancellation, limits,
  structural syntax failures or cleanup errors to a LET status (C4 below).
- Existing function locals, prefix restoration, subshell/child invocation state
  cloning, errexit/conditional suppression and cleanup remain authoritative.
  `context.invoke` runs in a cloned child state, not the caller's local scope.
  LET itself does not read stdin or acquire iterators; the enclosing Shell may
  acquire/close its input view. No whole-Shell no-acquisition claim.

## Source reuse / limits

`arithmetic.ts` is unchanged from baseline. It already provides:

- Lines 29–35: comma, assignment/compound assignment, ternary, short-circuit
  logical, bitwise, comparisons, shifts, arithmetic, exponentiation. Lines
  70–109: prefix/postfix increment, name-only lvalues, parentheses, right-
  associative assignments/power, unary precedence. N14's `-2**2` is 4 in native;
  do not introduce a different exponent precedence.
- Lines 37–53/85/203: decimal, hex, octal, base 2–64; signed 64-bit wrap,
  modulo-64 shift counts (156–157), truncating integer division, trapped zero
  division/modulo and negative exponent. N13's MAX+1 and MIN/-1 both produce
  `-9223372036854775808`, shift `1<<65` yields 2. These examples agree with the
  inferred current engine; no product replay was performed.
- Lines 55–118: token array then AST; ASCII variable names, JavaScript `\s`
  whitespace, no locale-byte fidelity claim. Empty token stream is zero.
  Parser recursion guard is 64 nested expression calls, not simply 64 visible
  parenthesis pairs. `prepareArithmetic` retains most syntax errors but throws
  its nesting error immediately.
- Lines 134–217: 10,000 AST visits **per evaluator call**, recursive variable
  expression lookup with cycle/64-active-name guard, lazy branches. Recursive
  variable parsing shares the evaluator's visit counter; distinct argv
  expressions start separate existing evaluator calls. Not one shared 10,000
  command-wide budget. Unset/empty variables are zero, without new nounset or
  integer-declaration features.

Shell source admission already bounds `maxSourceBytes` (default 1 MiB);
`words` (2419) bounds the combined expanded field count (default 10,000,
including the command field), while `word` (2612) bounds expansion bytes **per
source word**, including that word's expanded results (default 16 MiB).
Literal `context.invoke` passes NUL-free strings (2090), wraps them as quoted
words (2100), and runs the same command admission. No new Budget; no reset of
shared command/output/source/depth counters. Do not incorrectly advertise
`maxExpansionBytes` as an aggregate cap across all arguments/environment.

Recommended LET-only admission after middleware forwarding: check field count
including command, string/NUL validity and each operand's UTF-8 bytes against
those same existing limits before evaluation; mirror the existing getopts
admission/checkpoint pattern (2135–2187), not its scanner implementation.
Use the existing substring pattern (2496–2519): a read-checking Proxy layered
over `arithmeticVariables` to bound each recursively read variable string by
`maxExpansionBytes` and recheck the current signal; successful stores still
use the checked write proxy. This closes the route from large host/middleware
environment values without broadening arithmetic.ts or inventing a token cap.

Recommended cooperative checkpoints: current signal before admission and each
operand; interruptible `setImmediate` at each completed block of 128 admission
items/evaluated operands; signal before/after every yield and before success.
Keep all counters private to the call and use the existing limits/interruptible
helper. Do not charge each arithmetic node as another shell command/loop.

**Limit qualification:** parsing/token allocation/BigInt conversion are
synchronous and not covered by the 10,000 AST counter. BigInt literals may grow
before 64-bit normalization; tokenizer slicing, recursive evaluation depth,
large caller strings and recursive reparsing do not establish linear CPU,
constant memory or guaranteed stack safety at every admitted maximum. No new
preemption or hard-latency claim. The recommended byte checks reuse existing
bounds, not proof that every maximum-size arithmetic workload is cheap. If
root requires tighter CPU/stack guarantees, that is a separate arithmetic-core
design/review, NOT permission to slip a second engine into LET.

## Cancellation, state and cleanup

Reuse command tick/signal checks at runtime 988–990 and child dispatch scope at
1364–1374. LET introduces no resources, timers, child invocation, filesystem
operations or private provider work. Existing native scripts say nothing about
asynchronous abort. Finite synchronous evaluation can only observe abort before
and after it or at explicit per-operand checkpoints, not during opaque JS work.

At error boundaries, recheck the live signal and preserve `ShellLimitError`,
`Flow` and structural `ShellSyntaxError`. `executeCommand` 1066–1085 already
distinguishes these from ordinary status-1 diagnostics. The accepted Stage2
selector (`cancellation.ts:758`) gives visible root-caller reasons precedence,
preserves non-invoke failures, and uses classified lineage for invoke controls;
do not infer control identity solely from an equal reason object or add an
error-message classifier. Scope close/failure delivery remains existing
`cleanup.ts` plus `shell.ts`; no early success while children/cleanup remain.
Normal prefix/local restoration in `finally` is preserved even on rejection;
earlier non-prefix assignments are not rollback transactions.

## Explicit exclusions and readonly qualifications

No arrays/subscripts, associative arrays, floating-point arithmetic, `declare
-i`/nameref semantics, arbitrary shell syntax inside literal strings, host
`eval`/`Function`, GNU enable/disable machinery, extra arithmetic operators,
async host preemption, or native process parity. Native N22 successfully writes
`items[0]`; the current parser rejects it before evaluation. Outer shell word
expansion still operates before the builtin: N23's quoted literal `$(...)`
fails as arithmetic, whereas outer double-quoted substitution supplies 9.
Do not confuse rejecting literal shell syntax with disabling outer expansion.

The current project intentionally has stronger checked readonly behavior than
GNU in **getopts/CD**, not a newly discovered blanket LET difference:
getopts keeps readonly OPTARG/attributes and stops at the first failed checked
publication; CD checks OLDPWD before changing cwd. Existing report references
are separately hashed in `REFERENCE-BINDINGS.json`. Direct LET readonly rows
N15/N16/N26 agree in value protection and stopping: RHS `side=5` remains, locked
stays 1, later argv is not run; no claim that those native rows bypass readonly.
Preserve stronger cross-builtin policy rather than weaken the common setter to
imitate a different native builtin. This review did not rerun getopts/CD.

## Root choices before author go

| Choice | Observed/inferred distinction | Recommendation |
| --- | --- | --- |
| C1 syntax side effects | Native N10 `(value=7),1+` leaves value=7; existing parser must finish the whole argument AST before evaluation, so inferred value=0 | Explicitly accept per-argument parse-before-effects. Preserve N09's earlier **argument** writes. No parser change for GNU partial-parse effects. |
| C2 environment-prefix restoration | Native N17 `value=7 let 'value+=1' 'other=value'` leaves value=8, other=8; current `simple` finally restores saved value=2 while other=8 persists | Retain the existing project's prefix restoration, also on error/abort; disclose native difference. No LET-only restore exception. |
| C3 help surface | Native N06 prints GNU help, status2; `--version` is actually predecrement of variable `version`, yielding success, not a version option | Reserve only first-token `--help` before `--` and refuse with proposed exact status2 / `let: --help: unsupported option` Shell diagnostic. Keep other negative/decrement operands arithmetic, including `--version`. This explicit help exclusion needs approval; alternatively root can approve a fixed project help text/status2 before independent freeze. |
| C4 bounds/control | Existing parser nesting failure escapes preparation as ShellSyntaxError, while ordinary evaluator failures become Error | Preserve structural syntax/control/limit routing; do not normalize every failure to 1. Confirm acceptance of existing synchronous resource qualifications rather than claiming a new CPU/stack guarantee. |

No choice is silently ratified by this document or by collecting native data.
Exact future independent literals can freeze after root selects these values.
