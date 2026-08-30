# Exact guarded baseline after independent native freeze

Freeze commit: **c0aec9fc240f153e0fa18d6e2d1e291871dbe1eb**.
It was published immediately to `/tmp/expr-history-freeze-v4-20260827-candidate.txt`
before this task executed any product baseline. No TEMP variant was run here.
The candidate pointer is the original pre-baseline receipt, not a moving status.

## Inputs, profiles and chronology

- 32 distinct ASCII/C subject-pattern inputs: **14 exact old pairs + 18 newly
  selected pairs**, relative to the three explicitly bound historical catalogs.
  This does not claim the 18 pairs never appeared anywhere in the repository.
- All minimal P/Q/F/D/E witnesses are included. The historical nonrepeated
  `\(a\|aa\)a*` and mandatory `\(a*\)\{2\}` identities are distinct from
  repeated alternation and Q's trailing-backreference pattern.
- Native capture: **2026-08-27T22:06:27.233Z–22:06:27.697Z**. GNU 9.7 Darwin
  and Apple Darwin, each with portable and `+` argv, give **128 semantic calls**;
  two version probes are additional qualification calls, not new regex inputs.
  Zero execution failures, timeouts or signals. Utility syntax errors remain.
- GNU binary SHA256:
  `e8a4e2b58a33d2ad6bfa9eb8a4ed5f62775ab9ceac4b9421680c98973fd9109c`.
  Apple `/bin/expr` SHA256:
  `584ea6af503bdb3cc647c128a16a1aa9d22d3eeab136671f746a209bfef7db9f`.
  Both hashes matched before/after. Native environment is exactly
  `{PATH:"/usr/bin:/bin",LC_ALL:"C",LANG:"C",LANGUAGE:"C",TZ:"UTC"}`.
- Native argv0 is explicitly recorded as the absolute executable filename,
  not asserted to be virtual CommandContext.command. Each actual argv and all
  status/stdout/stderr hex bytes are frozen. Apple rejects the `+` invocation
  form on all 32 pairs: this is not a 32-case regex-engine failure cohort.
- No CLI-derived native internal offsets are invented. Previously qualified
  libc/register records remain bound in the old evidence; none is relabeled as
  a fresh GNU/Apple expr register trace. No new external research was needed.

## Source authentication and execution

Baseline commit: **c3e40f8bd721da5e496f3b3abfd51aee45db5a84**, exact Git archive,
with no overlay, live source injection, private runtime, shared dist or TEMP.
Archive/source/compiled identities are in `baseline-01.json`. All 248 product
source files and five root build/package files came from that commit. The
isolated build passed with installed TypeScript **5.9.3**, Node **v22.22.2**,
Darwin **25.4.0 arm64**. Compiler entrypoint and Node binary hashes are recorded;
this is not a fully independently authenticated transitive compiler/toolchain.

- Worker source: `f5c67e9c76b584337ae506b59449ecdcd945207b2269fdb4f79c5d1f7e81aff0`.
- Worker emitted JS: `e744453f4430b6a929cadac4e4b6a8a4e58ac75440ef16006ff4f4dab31f4874`.
- Command source: `e7cf6a0077a291578f4c669fe41da37188be8cebcb19bdb574838fd7fae2eb8e`.
- Baseline interval: **2026-08-27T22:10:57.755Z–22:11:01.494Z**.

32 actual RegexExecutor byte-profile requests plus 64 actual
`createExprCommand().execute` invocations (portable and `+`) used isolated worker
threads. These are direct CommandContext invocations, **not Shell.exec**.
Command cwd `/`, exact virtual env `{LC_ALL:"C"}`, empty memory FS, default stdin
provenance and a throwing stdin acquisition probe are explicit. The command
cleanup hook is registered before worker admission; invocation settlement is
followed by overlapping calls to the same registered cleanup.

Direct requests use the exact accepted protocol ceilings; command invocations
use exact accepted default command budgets and executor timeouts, all serialized
in the capture. The host process has a separate 120-second watchdog; native
calls have two-second SIGKILL deadlines and 64-KiB collection bounds. No trusted
main-thread path executes supplied BRE. Raw byte spans are protocol-validated.

## Honest baseline denominator

**21 supported observations, nine guarded unsupported responses, two syntax
errors**, not 32 semantic passes. Each command form has the same classification.

- Unsupported: P-empty, P-a, P-aaa, P-aaaa, Q-empty, Q-aaa, F-aa,
  required-child-empty, required-empty-after-prefix. All remain unsupported,
  including P/aaa despite the root's separate completed-`a` target.
- Syntax errors: open-self-reference and open-reentry-reference. Both return
  status 2 and exact GNU-matching diagnostics, not completed-capture successes.
- 20/21 supported results agree with each GNU command form. The one difference
  is the **old** absent-branch-reference extension control: product no-match
  versus GNU syntax rejection. It is neither new nor waived.
- Raw exact GNU command agreement is 22/32, comprising those 20 supported rows
  and the two syntax-error rows. This mixed count is **not semantic acceptance**.
- Apple portable command agreement is 12/32 (12/21 supported rows). Native
  differences are qualified separately, not interpreted as normative votes.

## Focused priority findings

No new GNU-qualified supported-profile defect was demonstrated by these 18 newly
selected pairs. The illustrative `a*\(a*\)` / `aaa` is **not** a baseline bug:
the guarded worker's whole span is `[0,3)`, first capture `[3,3)`, and command
tuple is stdout `0a`, status 1, empty stderr. Both native portable profiles agree
on that command tuple. This supplies a frozen counterexample against blindly
maximizing final capture length; it does not prove a universal comparator.

All spans below are **product byte spans only**. Commands include newline hex;
all listed stderr is empty.

| Frozen id | Product whole / first capture | Product and GNU stdout / status | Apple portable stdout / status |
| --- | --- | --- | --- |
| prefix-star | `[0,3)` / `[3,3)` | `0a / 1` | `0a / 1` |
| prefix-interval | `[0,3)` / `[2,3)` | `610a / 0` | `610a / 0` |
| prefix-dot | `[0,2)` / `[2,2)` | `0a / 1` | `0a / 1` |
| nested-prefix-reference | `[0,4)` / `[0,4)` | `616161610a / 0` | `6161610a / 0` |
| prefix-reference | `[0,4)` / `[4,4)` | `0a / 1` | `610a / 0` |
| two-references | `[0,2)` / `[0,1)` | `610a / 0` | `0a / 1` |
| descendant-reentered | `[0,5)` / `[2,4)` | `61620a / 0` | `61620a / 0` |
| descendant-reentered-empty | `[0,3)` / `[2,3)` | `610a / 0` | `610a / 0` |
| completed-empty-reference | `[0,1)` / `[0,1)` | `610a / 0` | `0a / 1` |

Newly selected Apple-portable divergences also include alternation-reversed and
prefix-alternation. In total six new-pair supported results differ from Apple,
all while agreeing with the qualified GNU profile. These are preserved profile
differences, not newly established defects in the accepted GNU-oriented profile.
The issue trigger found zero new supported GNU discrepancies, so it did not
create `/tmp/expr-history-freeze-v4-20260827-issue.txt` or claim a new bug.

## Project rules, ambiguity and preserved controls

Root's **P/aaa completed `a`** requirement remains independent of the GNU empty
observation. Activation-local required empty/progress and retention of the last
completed descendant until **that descendant reentry** remain explicit project
rules. Q/F and general competing histories are not normatively settled here.
No first-DFS promotion, longest-final-capture-only rule, universal POSIX/GNU
bug assertion, or expanded production support follows from these observations.

Original c433d023 author attempts, independent 954ddde4 attempts/corrections,
8897ece3 narrow normative evidence and b6eaa23a handoff records are byte-bound
and checked unchanged. Historical **137/137** protocol/lifecycle/limits/abort
results are bound with exact source/TAP identities for future variants, **not
rerun or claimed as fresh acceptance**. No quota or broad old-cohort rerun ran.

Four task-local safety checks passed: pre-aborted command preserves reason with
zero acquisition; registration-time close prevents acquisition; one work unit
refuses without best-so-far output; main-thread entry refuses before compiling.
These four checks do not replace the 137 controls or prove every cancellation
phase of a future history comparator.

## Integrity and cleanup

**97 workers**, zero active before safety cleanup and zero afterward. Normal
session cleanup accounts for 97 termination calls. Every acquisition checks
owner enrollment; all owned native/build/probe children were awaited. Both
source and compiled post-run inventories detect new files **and empty directories**
and reject symlinks. Old/frozen evidence hashes matched after execution.

Only the uniquely owned OS-temp archive/build scratch was removed. No native
fixture files, host user data, server, shared dist edit or runtime dependency was
needed. Unrelated concurrent work/staging was preserved. There is no opaque
host-work preemption, whole live-tree append-proof, universal parity, performance,
superiority or 72-hour completion claim.

Read-only final check: `node tests/commands/expr-stress/nullable-history-order-v4-20260827/frozen/verify-baseline.mjs`.
