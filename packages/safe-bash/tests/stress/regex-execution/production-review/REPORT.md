# Independent production regex review

**Decision: conditional source review only; production/default acceptance remains
BLOCKED.** F2 is independently fixed. F1 still violates awaited public cleanup.
The separately identified host-side glob/ignore path also remains outside the
authorized content-matcher implementation. No production edits, new contracts,
subagents, broad suite, fullgate acceptance, superiority or duration claim.

## Findings and final replay

Final source: `c467e8a7bdd78048985f97539bc76e38ff786b09`, following original
`b1939d76b8e28687320a7253380a00b446424548`. Independent freezes: `4bfc18d`
(initial) and `9d4518e` (final). Original failures are immutable at `a818f24`.
Final replay/evidence before package readback correction is `82de1ca`.

| Cohort | Initial source | Final source |
| --- | --- | --- |
| Original complete-command status/stdout/stderr byte equality | 24/24 | 24/24 |
| Additional final-cleanup assertion for that cohort | FAIL, one pending Worker | FAIL, one pending Worker |
| Named public lifecycle cases | 5/6 | 5/6 |
| Additional lifecycle final-cleanup assertion | FAIL | FAIL |
| Controlled transport/policy cases | 14/15 | 15/15 |
| Root-requested early-selection/line-budget cases | 2/2 | 2/2 |
| Full-command paired output-gated timings | Not run | 12/12 pairs, 24 timed commands |
| Correctly isolated moved-product consumer + declarations | Not run | Runtime pass; scoped types pass |

**F1, still blocked:** actual `Shell` with `agentCommands()` executes
`grep -E '^a' | head -n 1` on exactly `'ab\n'.repeat(200)`. It returns status 0,
stdout `ab\n`, empty stderr while one Worker has begun termination but has not
exited. Subsequent `await shell.dispose()` also does not await that retirement.
Observed final-source listeners include message 1, messageerror 1, error 1,
exit 3 (the latter includes verifier/native termination observers). Both original
and final public checks fail without changed expectations. All exact child
processes subsequently exit normally: this is premature public settlement,
**not evidence of an indefinite Worker leak**.

The followup author's path analysis agrees with this independent observation:
`src/commands/grep.ts` and `src/commands/search/rg.ts` await session closure in
finally, but interruptible dispatch/pipeline/Shell promise races can stop waiting
first. Plugin-wide disposal alone cannot repair earlier exec settlement. An
invocation-owned cooperative cleanup barrier needs explicit root-approved
contract/ownership; blindly awaiting uncooperative host work is not a fix.
No runtime, contract, shell or wrapper change was made by this verifier.

**F2, fixed:** the frozen safe transport fixture emits `messageerror` during an
accepted request. Initial client omitted the listener and eventually returned
`REQUEST_TIMEOUT`. Final client returns `PROTOCOL`, retires before settlement,
and removes listeners. Initial 14/15 and final 15/15 remain side by side.
This verifier injects an EventEmitter transport event; it does not claim a
naturally occurring native deserialization failure or spontaneous Worker crash.

## Source and scope

Preproduction freeze occurred at **2026-08-27T05:43:00.623Z**, before the author's
edits, committed as `5d1e65357734198744004baa0d5724ee4ebb6688`; the designated
baseline-ready marker includes exact hashes. The public dependency closure has
148 source/config identities, not an indiscriminate worktree copy. Initial
inspection saw dirty parser/runtime, but their owner committed before capture;
their exact consumed hashes and freeze HEAD `511a3370...` are recorded.

Initial/final production closures each contain 152 source/config identities and
588 emitted identities under independent strict NodeNext builds. Only client.ts
changes between those two consumed closures. Its final SHA-256 is
`79031a09a0d4259494d130aa47abcccebcd4230d7c83cc9feab07303ddf3a139`.
No consumed files were dirty at these freezes. Final audit finds no live source
drift and verifies all 659 historical artifacts plus the immutable prior archive.
Baseline-to-first also consumes other owners' committed package/tsconfig/WebDAV
changes, explicitly listed in the audit; this is not a clean regex-only whole-
repository differential. Original output cohorts were never replaced.

The compiled content graph uses static worker ESM and contains no eval, process,
filesystem, network or subprocess operations. Content compilation, fragments,
invalid UTF-8 handling and fixed-pattern matching remain worker-side; no host
literal fast path was introduced. Related public option forwarding and the
type-only export match root's narrow authorization. No new lifecycle contract
or runtime dependency was introduced by this work.

Broader claims remain false/unverified: `search/glob.ts:57` constructs user-derived
native regex, and `:61/:64` execute it through `walk.ts` CLI/ignore-file selection.
Root explicitly forbids those additional edits pending ownership. Existing
`shell/pattern.ts:59/:96` also uses constrained, escaped single-codepoint bracket
predicates inside its budgeted shell-pattern implementation; this is not arbitrary
content regex, but not literally zero dynamic host construction. Parser hex
regex construction selects trusted fixed maxima 2/4/8. No scope workaround,
workflow disabling, extra exploit probe or expanded engine audit was attempted.

## Controls and native evidence

The 24 original vectors and exact baseline bytes were frozen first. Initial
hand-written `rg-onlyempty` expected `aa\n`, whereas both actual baseline and
native rg emit `\naa\n\n`. That expectation defect remains visible as the
original 23/24 hand-expectation result. No product/native discrepancy is claimed
for it, and no frozen data was silently corrected. A separate guarded replay
compares the exact baseline bytes, not the mistaken hand-written expectation.

Twenty-two bounded native calls: 12 primary default-engine rg 15.2.0 and 10
primary **Darwin BSD grep** 2.6.0-FreeBSD; no GNU calls (`ggrep` unavailable in
the recorded PATH lookup). Native status/stdout agrees on 21/22. The exception
is the documented retained JS named-backreference behavior: product accepts
`(?<word>a)\k<word>`, native default rg rejects it. The allowed compatibility
rejection was not implemented; no rejection regression is falsely claimed.
Native diagnostics are retained, not asserted byte-identical to virtual errors.
These tiny primary cohorts do not replace the broader archived dialect evidence.

Public checks cover preabort before construction/input, live first-record output,
zero workers during tested idle-source waits, source cancellation, cross-shell
cancellation isolation, six concurrent invocations and early downstream exit.
Transport fixtures cover FIFO/cancel removal, count/descriptor+row byte overload,
capacity during awaited termination, independent executors, malformed ranges/IDs,
fatal events, idle retirement and timeout/abort precedence. The actual public
cross-shell control uses separate configured executors; exhaustive shared-
definition cross-shell schedules and arbitrary uncooperative sinks are not proved.

The default 1000ms no-caller-abort request policy is observed with a **safe fake
reply stall**, final elapsed 1003.846ms; it executes no regex. Startup default
3000ms and workers=2 are inspected; a separate 15ms fake startup stall is tested.
This is not a claim of terminating a real pathological expression at default
1000ms, a hard real-time deadline, or a process-wide memory guarantee.

## Full-command timing and package correction

Node 22.22.2, Darwin arm64, TypeScript 5.9.3. Each row has three alternating-order
baseline/production pairs, identical complete status/stdout/stderr bytes, and
new Shell/plugin construction plus awaited ordinary-command disposal in elapsed
time. Module import is outside timing. Workers are newly started per measured
production command; initial/JIT cache asymmetry and concurrent cohost load remain.

| Input / command | Baseline median ms | Production median ms |
| --- | ---: | ---: |
| 8 lines / grep | 0.772 | 14.257 |
| 8 lines / rg | 0.613 | 14.234 |
| 2000 lines / grep | 6.079 | 23.860 |
| 2000 lines / rg | 4.814 | 23.851 |

Raw startup-ready measurements are 11.791–22.062ms and overlap total elapsed;
they are not additive to it. These small results show overhead, not speed
superiority. No memory, steady-state, just-bash or deployment comparison ran.

The initial package smoke was a **harness false positive**: absent its own
package boundary, Node resolved the repository self-reference instead of the
extracted package. Original `package.json` evidence and `audit.json.packagePass`
remain unchanged and are not accepted as package proof. Correction `4686a17`
adds a distinct consumer package boundary and explicit resolution assertion.
One targeted rerun of the same public pipeline/declaration smoke passes from
the moved `node_modules/virtual-bash`. All eight worker-graph JS/declaration
asset hashes match the final isolated build. See `PACKAGE_CORRECTION.md` and
`evidence/production-final/package-corrected.json`; `audit-final.json` is the
corrected aggregate, not a rewrite of the old false-positive label.

## Risk, cleanup and remaining work

Independent new pathological probes **0/4**, author reports **0/2**, prior
revision 0 and historical 12 untouched. Root explicitly deferred the entire
six-probe tranche at the confirmed lifecycle blocker. Four prepared no-retry
cases were never claimed or launched; no costly baseline, warmup or fuzz ran.
Real pathological short-policy containment therefore remains unmeasured.

Eleven guarded children all exit 0 with exact disconnect/stdout/stderr closure,
zero watchdog kills. They observe 80 real Worker creations; four snapshots show
retirement still pending at public settlement (F1), so this report does **not**
claim 80 correctly awaited public cleanups. Two additional bounded package
consumer processes exit 0: one discarded self-reference proof, one corrected
packed proof. No broad kill or foreign artifact cleanup occurred. Reproducible
owned snapshot builds and moved packages remain ignored; no owned child runs.

Scoped independent builds, public consumer types, static syntax checks and
source/evidence digest audit pass. No global tests/typecheck or competing owner
suites were rerun. Fullgate e36dab2 remains separate. Further acceptance requires
approved F1 cleanup-contract work, the unresolved host-glob scope decision, and
an explicitly authorized continuation for deferred risk/remaining coverage.
