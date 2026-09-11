# Bugfix 653: resumable, jointly admitted text-program NFA work

## Authority and current state

September 8, 2026: root reports the full gate passed and issue 658 shipped at
`dac2c88de`, and granted the source writer window for issue 653. The bounded
temporary suite was rerun against current source before applying the prepared
patch: 13 tests, 11 genuine assertion failures and two passing controls.
Temporary evidence is not canonical test membership. No Git, builds, lint,
full suites, native fallback, or source-tree copies were used by this leaf.

Product ownership is limited to text-program NFA matching and its sed/awk
callers. Do not touch `src/shell/runtime.ts`, the shell glob engine, regex-worker
engines, other leaves' files, or historical sealed copies. Root owns inventory,
integration, Git, and release gates.

Follow-up grant on September 8, 2026 additionally owns only
`src/commands/stream-format/nl.ts`, its existing `nl.test.ts`, and this plan.
Issue 666 preparation is paused; other workers' canonical files remain frozen.

## Concrete evidence, not heap claims

- One synchronous `Pattern.find` exhausted 257 work units under a 256-step cap
  without reaching a checkpoint. The existing checkpoint immediately delivered
  the pending abort when explicitly called afterward.
- `(a*)(a*)b` over `aaaa` retains 470 visited-state bytes plus 192 queued-thread
  bytes under two independent 512-byte checks. This is their own accounting
  model, not a measured heap size.
- A new bounded control completes without a match under a 1,450-byte cap, even
  though its peak combined old-model charge is 1,516 bytes: 1,132 visited plus
  384 queued bytes. The peak was observed in-memory on the same execution shape
  with a 1,536-byte cap; the 1,450-byte run also completes normally.
- `save` copies capture arrays; other instructions can share those arrays.
  Do not describe every thread as a fresh capture copy.
- The existing 64-byte replacement-capacity test succeeds for pattern `a` and
  must continue to do so. Do not raise that cap to hide matcher overhead.
- No heap/RSS amplification ratio, OOM threshold, or real-time latency magnitude
  is established by these bounded witnesses.

## Matcher design

Keep compilation and `Match` fields unchanged. Make `find` return
`Promise<Match | undefined>` and suspend the existing iterative execution; do not
replace it with native RegExp, recursion, a worker, or a new regex dialect.

1. Observe the existing signal at entry, including `from` beyond the final
   offset. Keep existing work charges and add charges before variable-sized
   capture copies, state-key serialization, queue reversal, and result copying.
2. A local work helper calls `budget.step(count)` and checks
   `budget.checkpoint()` every 64 charged work units. Await only returned
   checkpoints, rather than creating a Promise for every transition. The existing
   elapsed-time/periodic yielding policy remains in `shared.ts` unchanged.
3. Cover position scans, pending-thread processing, backreference byte loops,
   capture tie comparisons, and group materialization. Checking positions alone
   is insufficient: one position can contain many epsilon/capture states.
4. Preserve increasing candidate starts, position ordering, queued-list
   reverse/pop order, and split's second-then-first push order. Preserve current
   visited-state identity, longest whole match at the earliest start, and the
   existing lexicographic capture-length preference on whole-match ties.
5. Retain only the winning end/capture vector during traversal. Build substring
   groups once after that start's search completes, not on every improving match.
   Undefined captures remain undefined; empty captures remain empty strings.

### Small deterministic path

Compute a flag once during compilation for programs containing only character,
begin, end, and match instructions. Execute those with scalar position/program
counters and the same cooperative work helper, without NFA queues or visited
sets. This is structural, not a special case for a named test or pattern string.
It preserves the verified 64-byte replacement route without a minimum-cap waiver.
Keep byte offsets, ignore-case character predicates, anchors, and `from` behavior.
Returned match text remains subject to the existing logical text cap; this path
does not claim that fixed JavaScript result-object overhead fits that many bytes.

## One NFA storage ledger

Use one invocation-local numeric ledger, not per-reservation objects/closures.
Its only capacity is the unchanged `budget.maxBufferBytes`. Reserve before
allocation; check safe integer arithmetic; release logical ownership without
requiring an un-aborted signal. Keep the existing state-buffer error diagnostic.

The initial patch uses conservative modeled charges, not asserted engine sizes:

| Owned storage | Charge |
| --- | --- |
| Active NFA container headers | 128 bytes |
| Position bucket/list ownership | 64 bytes |
| Thread plus capture-vector ownership | 64 + 8 × vector length |
| Numeric visited entry | 32 bytes |
| String visited entry/key | 64 + 2 × key length |
| Temporary joined capture text | 32 + 2 × upper-bound length |
| Winning capture retainer | 32 + 8 × vector length |

- Charge active popped threads until their transition finishes. Pending work,
  future-position work, current visited entries, winning captures, and temporary
  serialization must coexist in this ledger, not each receive the full cap.
- Conservatively charge capture-vector ownership per retained thread, even when
  a transition shares an array. This avoids reference-counting tables and their
  own bookkeeping amplification. A save reserves its enlarged vector before
  spreading/assigning it; initial empty vectors are also admitted.
- One enqueue path handles characters, backreferences, split, jump, save, and
  anchors. Pass scalar inputs into it; do not create the thread object or clone
  captures before admission. Transferring a bucket from the map to the active
  pending list transfers ownership, not releases it prematurely.
- Before `join`/interpolation, reserve an upper bound for both temporary joined
  text and the retained key/Set entry. Derive decimal-width bounds from the
  compiled instruction count and input length. After serialization release the
  unused bound/temporary charge; duplicate states release their key charge too.
- Release visited entries and drained bucket ownership between positions. Keep
  the winning capture charge independent of the thread that supplied it. Admit
  both old and new winners during replacement, then release the old winner.
- Admit aggregate result-array/string construction while the winner is retained.
  Clear maps/ledger on failure, cancellation, and completion in `finally`.
  There is no invocation state stored back on `Pattern`, so repeated/concurrent
  finds do not share a ledger.
- This is an NFA-owned storage model, not a command-wide/RSS limit. Borrowed input,
  compiled instructions, and separately budgeted replacement buffers do not
  silently become one process-memory guarantee. Any newly stricter pathological
  admission must be distinguished from semantic changes below the bound.

## Exact async propagation

All enclosing functions already support asynchronous execution; no shell-runtime
API changes are needed.

| Site | Required change |
| --- | --- |
| `regex.ts`, `substitute` | Await `pattern.find` before reading offsets/groups. |
| `sed.ts`, `matches(Address)` regex branch | Compare `(await ...find(...)) !== undefined`; leave numeric/last addresses and range logic unchanged. |
| `awk-runtime.ts`, regex separator branch of `split` | Await `matcher.find`; keep zero-length separator advancement and paragraph handling. |
| `awk-runtime.ts`, `evaluate`, `case "regex"` | Await before converting presence to numeric truth. |
| `awk-runtime.ts`, binary `~` / `!~` | Resolve the pattern, await the find, then test presence/negate. |
| `awk-runtime.ts`, builtin `match` | Await before updating `RSTART` and `RLENGTH`; preserve 1-based success and 0/-1 failure. |
| `stream-format/nl.ts`, pattern numbering style | Await before deciding whether to number a record; keep matcher charges on the invocation's existing `PatternBudget`/`Session`. |

`sub`/`gsub` already await `substitute`; FS and builtin `split` already await the
shared split method. Update both `find` mocks in
`substitution-admission.test.ts` to await the original before proxying groups or
scheduling cancellation. Do not compare a Promise to undefined or mutate awk
state before a match settles.

## Bounded TDD matrix

Temporary test: `/tmp/kamilio-653-6hwaZZ.test.ts`, absolute current-repo imports,
memory filesystem only. First corrected run: 13 tests, 11 genuine assertion
failures and two passing compatibility controls; no skips/cancellations.

- Fake monotonic clock plus a queued immediate abort: eight `a` bytes, two
  captures, maxSteps 512, maxBufferBytes 32,768. Require the exact reason from
  inside one find, rather than exhausting steps first.
- Four `a` bytes and the 1,450-byte combined-storage witness: require state-buffer
  refusal rather than successful completion under independent checks.
- One capture and a 32-byte cap in the temporary RED: reject before capture-key
  serialization. The canonical test strengthens this to 350 bytes, admitting
  the initial 256-byte container/thread reservation but refusing the first key.
- Already-aborted falsey reason with `from` beyond EOF: preserve exact identity.
- Keep the existing 64-byte replacement success and 65+-byte rejection boundary.
- Assert exact captures, optional/unmatched groups, repeated-group preference,
  BRE backreferences, case-insensitive backreferences, anchors with nonzero
  `from`, zero-width results, NUL and 0xff bytes.
- Promise-returning bounded `find` stubs exercise the six sed/awk call sites;
  cover both builtin split and FS splitting. These prove await propagation, not
  native-regex semantics by themselves.

Canonical controls additionally cover sixteen repeated successful/missing
search pairs on one budget, buffer and step failures followed by reuse, six
cancellation reason identities, and interleaved invocations of one compiled
pattern while one search is suspended with live storage. No large default-limit
stress or wall-clock sleeps. All resource limits remain unchanged. These are
observable cleanup/reuse controls, not instrumentation of every allocator or a
proof of physical garbage-collection timing.

### Temporary runner qualification

The `/tmp/*.test.ts` file is outside the repository ESM package and initially
loaded as CommonJS, which cannot access the import-only `poe-code/safe-fs/core`
export. The corrected run uses an in-memory `node:module.registerHooks` loader
restricted to that exact temporary test URL, transpiling only that test as ESM.
Product modules still come from the current repository unchanged via tsx. The
maintained `scripts/test-reporting.mjs` runs with `--import tsx`, that test-only
loader, `--experimental-test-isolation=none`, and `--test-concurrency=1`.
Use Node from `/tmp/kamilio-toolchain.path`, unset `NO_COLOR`, set
`TSX_DISABLE_CACHE=1`, and use the assigned validation base's `tmp` directory.
Do not classify the earlier loader failures as assertion RED.

## Implementation and handoff

The prepared `/tmp/kamilio-653-QBXARR.patch` was checked against current source
and applied only after the writer grant and fresh RED. Canonical edits are:

- `packages/safe-bash/src/commands/text-programs/regex.ts`
- `packages/safe-bash/src/commands/text-programs/sed.ts`
- `packages/safe-bash/src/commands/text-programs/awk-runtime.ts`
- `packages/safe-bash/tests/commands/text-programs/substitution-admission.test.ts`
- `packages/safe-bash/tests/commands/text-programs/nfa-work.test.ts` (new)
- `docs/plans/bugfix-653-nfa-work.md`

The dedicated NFA and adjacent substitution-admission tests pass 36/36 after
adding the cleanup controls. Canonical tests require only the usual tsx import,
not the temporary ESM hook. The maintained reporter command is run from
`packages/safe-bash`, with Node 22.22.0 and the assigned environment:

```sh
node scripts/test-reporting.mjs --import tsx --experimental-test-isolation=none --test-concurrency=1 tests/commands/text-programs/*.test.ts
```

The final adjacent run passes 408/408 assertions across 13 selected test files,
with zero failures, skips, cancellations or todos. The initial adjacent pass
covered 405 assertions before the three cleanup controls. No test processes
remain; the six owned paths are frozen for root integration.

The default isolated route
also completed all 13 selected files successfully, but its reporter exposed
only file-level counts in this environment; do not present those as individual
assertion counts. Root owns admission of the new test into the exact maintained
inventory, broader gates, Git, integration and release. A focused GREEN is not
remote-main delivery or a release claim.

## Root integration evidence — September 8, 2026

- The maintained selected virtual-bash/SafeFS build closure passed. Root lint
  passed after the nl await integration. Browser-engine tests passed 166/166;
  the production site built and actual browser output verified nl matching and
  nonmatching lines, sed captures, awk match offsets, jq key ordering and repeated
  redirect cleanup. Screenshot: `/tmp/kamilio-653-654-664-browser.png`.
- The complete maintained SafeBash unit route exercised 22,120 tests: 22,055
  passed, 63 were explicitly skipped, and two old synchronous jq comparator
  tests failed. The runner checks passed 282/282. No other full-sweep failures
  occurred after the nl correction.
- The two jq tests were migrated to the asynchronous comparator contract with
  every value, limit, equality assertion and abort identity unchanged. Their
  affected cohort then passed 102/102. Product source was unchanged by that
  test-only follow-up. This is broad coverage plus a focused correction, not a
  claimed uninterrupted clean full-suite rerun.
- The earlier partial run that exposed the nl caller is retained as failed,
  incomplete evidence. Gate logs are under `/tmp/kamilio-653-654-664.tX9mlg`.

## Integration follow-up: nl asynchronous caller

Root reports candidate commit `a784e3da9` and current HEAD `b60a6a7c5`; the full
SafeBash unit gate found the omitted `nl` consumer. The original six-site audit
was incomplete: `nl` also imports this exact `Pattern`, not a separate matcher.
`current.find(...) !== undefined` numbered nonmatches and detached rejection
from the command's error/cancellation handling after `find` became async.

Fresh maintained RED on current source: the existing two-test `nl.test.ts`
had one failure (escaped shared-step-limit error) and one pass. Seven additional
bounded regressions produced eight failures and one pass before the fix:
actual matching/nonmatching records, BRE captures/backreferences, header/body/
footer numbering, NUL/non-UTF-8 bytes, exact shared budget, and queued falsey/
object cancellation with no output. No source changes preceded that RED.

The production fix is one awaited call in `nl.ts`. `PatternBudget.step` still
charges the existing session; no budget or diagnostic/status mapping changed.
Dedicated GREEN is 9/9. Actual shared work is 39 units for three short records:
39 passes with exact expected output; 38 fails with the existing step diagnostic.
Cancellation returns the exact `false`/object reason and writes zero bytes.

The fresh production-source import audit found four importers of this exact
module: `sed.ts`, `awk-runtime.ts`, `awk-syntax.ts`, and `stream-format/nl.ts`.
`awk-syntax.ts` only constructs patterns. Counting the internal `substitute`
consumer gives seven production `find` calls: four awk, one sed, one substitute,
one nl; all are now awaited. Unrelated shell/tree/SafeJS pattern engines are
not consumers of this API.

Final maintained focused command from `packages/safe-bash`:

```sh
node scripts/test-reporting.mjs --import tsx --experimental-test-isolation=none --test-concurrency=1 tests/commands/stream-format/*.test.ts tests/commands/text-programs/*.test.ts
```

Result: 440/440 assertions across 18 selected files, zero failures, skips,
cancellations or todos. Node 22.22.0, `TSX_DISABLE_CACHE=1`, unset `NO_COLOR`,
assigned validation `TMPDIR`. Follow-up edits are exactly the nl source, existing
nl test, and this plan; frozen with no test processes remaining. No new inventory
member, Git operation, build, lint or full suite was performed by this leaf.
