# Search failure sidecar — bounded independent read-only review

## Verdict

**The stalled-stdin failure is a genuine lost-upstream-close bug in the direct
search command path, not an opaque-fixture waiver.** The original fixture supplies
a structural iterator whose `return()` is independently callable and immediately
resolves. Product `AvailableRecords.source()` inserts an async generator around
its pending `next()`. Cancellation reaches that wrapper's `return()`, not the
fixture's `return()`. After the fixture rejects the pending read, the wrapper
finishes without returning the original iterator. The unchanged assertion fails.

**The differential whole-gate timeout remains unresolved.** Its exact historical
failure and same-candidate isolated **486/486** pass are separate cohorts. This
sidecar does not run that 486-case corpus again, generate concurrency load, increase
timeouts, or infer a green gate from the isolated result.

No production, contracts, configuration, old tests, root exports, or root `dist`
were edited. No dependencies installed, network/native userdata accessed, delegation,
old-five first-read investigation, full gate, or global typecheck performed. This
is not source acceptance, a repaired candidate, or a superiority/completion claim.

## Candidate authentication

- Frozen: `b494675c34dc289f4ad4b10a9201e1211eb0a7d8`, from Curie's
  `tests/integration/full-gate-20260827/combined-b494675c/CANDIDATE.json`, captured
  canonical report, and independently resolved Git object. No short-SHA guessing.
- Initial live HEAD: `3ee476a8bdd750b889b0b83eb0f5927d7b5be670`; preparation-end
  live HEAD: `46447153e5f6d6428f70027c9aeee00ac248b47f`. Foreign work continued.
  These are not interchangeable with the frozen candidate. Final live observation
  and exact unchanged-path inventory are recorded in `integrity.json`.
- Historical candidate directories were removed, as recorded in Curie's
  `CLEANUP.json`. The review reconstructed **229 frozen source/search-test/config
  files** in `/tmp/safe-bash-search-sidecar-review-tnXxyl/source`, checking every
  byte against both Git and the historical canonical source-hash capture.
- `qualification.json` lists every frozen Git blob, SHA256, inspected current
  SHA256, and unchanged flag. All frozen search, regex-execution, shell, contracts,
  and search-test paths matched inspected current bytes. Preparation differences
  were `package.json`, `tsconfig.json`, and `src/commands/execution.ts`; inventory
  additions/current drift are separate in `integrity.json`.
- Node `v22.22.2` and pinned ripgrep `15.2.0 (rev e89fff89ac)` executable hashes
  match the old capture. **192** copied tsx/esbuild/TypeScript files also match.
  Native tests use only the authenticated copied rg; no substitute/install.
- Frozen regex-execution TypeScript was locally transpiled to task-owned worker
  JS with the authenticated TypeScript tool (ES2023/ESNext/verbatimModuleSyntax).
  This is **not historical emitted-JS byte identity** or a full historical build.
  Generated hashes are recorded. Root `dist` is neither rebuilt nor used.
- The old canonical/serial/focused raw captures were verified against stored and
  decoded SHA256 and byte lengths in `EVIDENCE_MANIFEST.json`. `historical-summary.json`
  authenticates the old cohorts and indexes full originals. Large duplicate full
  logs are not necessary: original files remain untouched; exact search failure
  excerpts and isolated search raw logs are retained here as inert `.data`.

## Bounded new replay

All children use `TSX_DISABLE_CACHE=1`, task `TMPDIR`/`TMP`/`TEMP`, isolated HOME,
LC_ALL/LANG=C, TZ=UTC, empty RIPGREP_CONFIG_PATH, and the copied pinned rg first in
PATH. `NODE_OPTIONS`/`NODE_TEST_CONTEXT` are removed for these new launches. This
does **not** recreate the old whole-gate import-guard/concurrency/cohost conditions.
Exact executable, arguments, environment, cwd, timestamps, status, stdout, stderr,
process snapshots and closure records are in `runs/*.json` and `runs/*.data`.

```sh
cd /tmp/safe-bash-search-sidecar-review-tnXxyl/source
PATH=/tmp/safe-bash-search-sidecar-review-tnXxyl/native-bin:/Users/kjopek/.nvm/versions/node/v22.22.2/bin:/usr/bin:/bin \
TSX_DISABLE_CACHE=1 TMPDIR=/tmp/safe-bash-search-sidecar-review-tnXxyl/tmp \
node --import tsx --test --test-concurrency=1 \
  '--test-name-pattern=^isolated cancellation and iterator lifecycle checks$' \
  tests/commands/search-stress/safety.test.ts
```

This selects the original wrapper without editing it; the unchanged wrapper runs
all ten original nested cases with its original **5000ms** subprocess bound.
The runner additionally wraps the command in `/usr/bin/time -l`; its 20-second
outer emergency guard cannot extend the original fixture's bound and did not fire.

**One original replay, status 1:** outer 0 pass / 1 fail; nested 9 pass / 1 fail,
specifically `safety-cases.ts:39` (`false !== true`), matching the requested defect.
It ran August 27, 2026, 12:36:51–12:36:52 UTC. `/usr/bin/time`: 0.94s real,
0.49s user, 0.10s sys; full runner wall 1175.867ms includes snapshots/closure check.
The nested failing case reports 38.836167ms. Original stdout/stderr are unmodified.
There is no new current-full-candidate replay: relevant bytes match, but current
whole-product behavior is not inferred from that fact.

The original whole-gate wrapper also recorded an additional nested empty-chunk
closure failure (`safety-cases.ts:109`, 8 pass / 2 fail). This replay's corresponding
case passed. Both original diagnostics are preserved; this sidecar makes no
classification or resolution claim about that additional variable observation.

## Single finite ownership diagnostic

Command: same qualified environment and cwd, `node --import tsx ownership-diagnostic.ts`.
The exact executable copy is retained inert as `code/ownership-diagnostic.ts.data`.
It adds a forward-only logging proxy around the **original**
`AvailableRecords.source` iterator (`next`/`return` invocation and settlement), plus
raw fixture events. The public command wrapper forwards the real registered regex
cleanup, logging drain start/end. It does not replace product source or assertions.
Three sequential profiles are one diagnostic, not extra original test replays:

| Profile | Raw return at execution settlement | After releasing pending read | Meaning |
| --- | --- | --- | --- |
| Direct structural, original fixture shape | Not called | Still not called after rejection + 20ms | Lost raw close; fixture cleanup calls return manually afterward, explicitly NOT product behavior |
| Actual public Shell, structural input | Called and completed | Remains complete | Top-level Shell owns/closes raw cursor; command receives borrowed non-returnable input view |
| Actual public Shell, gated opaque async generator | Called, generator finally incomplete | Gate release lets finally and return complete | Invocation is not completion; this genuinely opaque control is distinct from original structural fixture |

Direct event order: `available.return.call` → execution rejects with exact abort
reason → fixture rejects pending raw next → `available.next.reject` →
`available.return.complete` → after-20ms observation still no raw return. Only the
diagnostic's explicitly marked manual cleanup then invokes raw return.

Public structural event order: owner raw return completes → registered regex
cleanup drains → execution rejects with exact reason. The original command's
`withRegexSession` registers regex-session ownership, **not stdin ownership**.
Both public profiles log that the command's stdin is not the raw fixture and its
iterator has no return method. Runtime/contract source inspection, not an added
nested experiment, establishes that omitted `invoke` stdin borrows the existing
view, while replacement stdin gets an owned `ShellInput` with a finally close.

Public opaque control: the owner invokes return and completes registered regex
cleanup before public rejection, but the raw generator's finally executes only
after its test-controlled gate release. No unregistered opaque-input promise is
promoted into an invocation cleanup barrier. There is no universal pending-read
preemption or cursor-conservation promise, and no need to rewrite the structural
fixture as opaque to explain it.

Diagnostic **status 0**, August 27, 2026, 12:38:18 UTC; 0.27s real / 0.23s user /
0.04s sys, runner wall 508.425125ms. All created raw read/return and wrapper promises
were settled; both shells disposed; no unhandled rejection. Original replay and
diagnostic process groups closed with no remaining members and no kill signals.

## Differential timeout boundary

Old whole gate: `npm test`, selected 550 canonical files; **16,840 total, 16,520
pass, 307 fail, 13 skip**, zero cancelled/TODO. Qualification was invalidated by
missing native prerequisites and a tracked historical-artifact write; no later
focused result subtracts from those failures.

The exact stack is `differential.test.ts:85` → `virtual()` at `harness.ts:38` →
`bounded()` assertion at `harness.ts:31`, reporting `spawnSync node ETIMEDOUT`.
The subprocess is `node --import tsx tests/commands/search-stress/worker.ts`.
The test-file failure duration is **10211.435625ms**. This is the **10,000ms
subprocess envelope at file bootstrap**, before individual differential test
registration, not an individual test-body budget. The worker handles the complete
virtual probe array, including loader/module setup, filesystem setup, virtual
execution and regex workers, before emitting JSON. Native per-case comparisons
come afterward. It cannot be identified as loader-only from this stack.

The distinct regex policy has default 3000ms worker startup and 1000ms request
budgets (`src/commands/regex-execution/protocol.ts`); neither diagnostic is the
observed `spawnSync ETIMEDOUT`. Old logs do not separate loader CPU/wall, regex
startup, or execution time. No invented CPU cause or timeout increase is proposed.

Historical isolated command: `node --import tsx --test
tests/commands/search-stress/differential.test.ts`, same recorded frozen candidate,
**486/486**, status 0, runner 11553ms / TAP duration 11353.177041ms. Its total can
exceed ten seconds because native comparisons are outside the worker's ten-second
envelope. Historical focused source-hash list contains 212 source paths and they
all match reconstructed bytes; that list does not separately hash tests/config.
Canonical capture + Git authenticate those; do not claim the focused source list
alone independently attests every focused fixture byte.

This sidecar introduced no competing load. Host snapshots report 15 CPUs/available
parallelism; load averages at safety start were 4.0894/5.4302/4.7383 and diagnostic
start 3.4512/4.9448/4.6235. Other owners continued work; cohost load was not controlled.
These new observations do not recover the old gate's load/concurrency and cannot
attribute its failure. Root/gate fixture owner retains unresolved concurrency
investigation; no new differential experiment was necessary or run.

## Smallest proposed fix and authorization

`proposal.patch-data` is **unapplied and unvalidated**, not a source change.
For stdin only, put signal-aware `readBytes(stdin, limits.signal)` **inside** the
`AvailableRecords.source` wrapper by changing searchFile's stdin source selection.
This makes the inner pending read independently interruptible so its finally can
reach the actual structural iterator's return. The FS branch already has an inner
`readBytes` via `fileInput`, consistent with its passing original stalled-readStream
control. Do not solve this by raising a timeout or weakening the original assertion.

Smallest source write ownership needed: **`src/commands/search/rg.ts`**, plus an
explicitly assigned new search lifecycle regression path. Root must transfer it;
this leaf does not edit or wait for permission. `src/commands/regex-execution/client.ts`
is the reviewed wrapper site, but need not change for this search-local proposal.
Its other grep caller was located, not investigated or certified. A broader shared
wrapper change would require separate regex/grep ownership approval.

Owner validation should preserve the unchanged original assertion and cover a
structural pending-next source, post-abort late rejection/no unhandled rejection,
return invocation versus asynchronous completion, actual Shell borrowed ownership,
and a gated opaque-generator negative control. Keep registered cooperative cleanup
separate; do not add indefinite awaits of raw opaque work. This is a proposal for
owner review, not proof that the patch passes those regressions.

## Evidence layout and closure

- `qualification.json`: frozen/current/source/test/tool/config/generated hashes.
- `historical-summary.json`: authenticated original capture references, exact old
  commands/statuses/cohorts and focused-source check.
- `historical/*`: original search logs and exact full-gate search excerpts, inert data.
- `runs/*`: two new executions, unmodified stdout/stderr, CPU/wall and process closure.
- `code/*.data`: exact preparation/runner/diagnostic programs; no raw TS discovery.
- `integrity.json`: post-run frozen-byte/tool verification, live drift, input/group closure.
- `evidence-manifest.json`: final own evidence SHA256 inventory, excluding itself.

Task status/needs-root were published before tests at the required `/tmp` paths;
`/tmp/safe-bash-search-sidecar-review-final-result.txt` records finite completion.
Temporary copies are retained for exact replay, with no child processes left running.
Root verifies this leaf's actual exit; no 72-hour or universal acceptance claim.
