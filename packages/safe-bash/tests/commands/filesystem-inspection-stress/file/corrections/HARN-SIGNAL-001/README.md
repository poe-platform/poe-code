# HARN-SIGNAL-001: additive three-case correction

Root authorized this correction and **only F29/F33/F34 once** against the existing
old frozen candidate `d168d18b118592e04a6eec9b00eb50cc2b1e5058`. No new/live author
candidate was read or tested, and no production source was changed.

## Exact change

The original sealed runner and original selected-case runner are preserved with
their exact hashes/copies under `history/`. `assertion-correction.diff` contains
only two replacement blocks, recorded with their reasons in `correction.json`:

- F29 now requires an actual, active, unaborted `AbortSignal` with undefined reason,
  rather than reference equality with the caller's signal object.
- F33/F34 now require an actual aborted FS signal with `signal.reason ===` the
  original caller sentinel. The exact command-rejection reason assertion remains.

Every existing iterator-count, late-read rejection, late-return rejection, and
two-event-loop-turn unhandled-rejection assertion remains. No fixture, native
expectation, MIME/human/status predicate or other scenario changed. The separate
`observation-only.diff` adds event recording only within F33/F34; it attaches no
extra `then` or `catch` handlers that could hide a product rejection defect.

The minimal assertion-only runner and the runner with telemetry are both retained
under `runner/`. Five nonproduct self-checks pass, including reversible diffs,
negative active/aborted signal controls, and exact reason-identity controls.

## New execution: three cases, not forty

The three sequential children ran once from 08:44:11.505 to 08:44:11.696 UTC on
August 27, 2026. Each had the existing 60-second watchdog; the controller retained
the 10-minute global bound. All three completed and passed; no retries, timeout,
new native calls, content cohort, or other product case ran.

| Case | New result | Recorded obligations |
| --- | --- | --- |
| F29 | Pass | PNG classification; bounded readFile; actual active/unaborted FS signals |
| F33 | Pass | Exact caller reason; FS abort propagation; next=1, return=1; late read rejection injected; unchanged two-turn unhandled check executed |
| F34 | Pass | Exact caller reason; FS abort propagation; next=1, return=1; late read and pending-return rejections injected; unchanged two-turn unhandled check executed |

F33 recorded one late-read rejection injection. F34 recorded one late-read and
one late-return rejection injection. Both then recorded the completed observation
window with zero unhandled rejections. This is based on genuine injections and
the original assertions, unlike the initial interrupted probes. It does not
claim that uncooperative host work can be stopped or establish unlimited-latency
cleanup behavior. All three children exited and were reaped; no owned job remains.

## History and reuse

The original 54-artifact seal, original `PRESEAL.json`, all 285 original publication
entries and the original 40 raw reports remain unchanged. In particular, the
historical raw counts stay **35 pass, 3 fail, 2 backend limitations**.

`evidence/coverage-index.json` explicitly labels the other **37 rows as reused**
from the initial run. It is an evidence index, not a newly executed full-40 cohort.
With the three corrected observations selected, that mixed-provenance index has
34 pass, 4 native-profile conflicts and 2 backend limitations. It is not all-pass.
All 80 content views and native-exact counts in that index are historical/reused;
none was rerun in this correction phase.

SQLite's accepted interoperability issue remains in the reused old-candidate
results. The author's canonical-MIME fix is not tested here. Static peer review
and a later author-fixed full-40 run remain separate root assignments.

All 590 old candidate source/dev/build files and the sealed inputs were rehashed.
Runtime imports stayed within the correction's harness copies and the existing
read-only old compiled snapshot. The documented 64-KiB sniff/readFile profile is
unchanged. No live source alias, dependency install, source rebuild or vendored
dependency was introduced.

Raw corrected reports, event/return/injection counts, module logs, process records,
before/after integrity evidence and the reused mapping are under `evidence/`.
`PUBLICATION.json` seals this additive correction only; the original publication
manifest is untouched. Root detail: `/tmp/safe-bash-file-harness-correction-detail.txt`.
No staging or commit. Stop at this three-case correction checkpoint.
