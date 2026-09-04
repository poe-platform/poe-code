# Issue #601: sort record admission

## Validated baseline

Baseline: `6dad4fcdcb72c527aae26f87f83e41475c459fd3`, September 4, 2026.
Current sort charges payload bytes plus one delimiter against a fixed 32 MiB
limit but retains a separate typed-array record and vector entry for every
record. Merge sorting allocates a second reference vector. Numeric caches have
their own 16,384-entry / 1 MiB guards; they do not bound the main vector.

Small public Shell witnesses supplied 4, 8 and 16 empty records in one chunk.
Ordinary, NUL-delimited, numeric, check and unique modes retained respectively
4, 8 and 16 record entries. Check mode emitted nothing; unique emitted one
delimiter. Observed vector-push instrumentation was restored afterward.
The existing byte rule does impose a finite count (up to 33,554,432 empty
records), but it omits an independent metadata bound. Historical RSS/OOM,
amplification and elapsed-time figures were not reproduced.

This is distinct from #586: delimiter-only single-chunk inputs require no
fragmented long-line accumulation. Do not modify the shared line reader or
claim its fragment-retention problem is fixed by this issue.

## Selected policy

Add an invocation-wide maximum of 100,000 completed records alongside the
existing 32 MiB payload-plus-delimiter allowance. A fixed record ceiling is
explicit and testable; it does not pretend that an assumed per-object byte
estimate measures a particular JavaScript engine's heap. The value is a selected
resource policy, not derived from the report's unverified amplification ratio.
No public option or general-purpose memory budget is added.

One admission ledger covers every operand and all sort modes, including check,
unique and numeric sorting. Admit record count and bytes atomically before the
completed record is copied/concatenated and before vector retention. Keep the
existing EFBIG diagnostic and status-2 route. Check-mode disorder remains
status 1, with existing numbering, duplicate and early-stop behavior.

Use the sort-local collector for pre-materialization admission. Pending input
fragments, numeric caches, output buffering and native allocator behavior retain
their separate existing limits; this is not a universal heap cap. Do not add a
streaming-check optimization or redesign shared line handling in this patch.

## Ownership and validation

- Budget owner: new `sort-admission.ts` and `core-sort/record-budget.test.ts`.
- Sort owner: only sort code in `text.ts` and new
  `core-sort/record-admission.test.ts`.
- Independent owner: `core-sort/record-integration.test.ts` and exact literal
  test registrations in `integration-inputs.test.mjs`.
- Root: contract, integration review, maintained build/current consumers/public
  exports/lint, exact commit ownership, verified push, closure and release watch.

Preserve the user's staged cut line and the staged helper/text tests. Never
commit them as part of this issue. Any temporary index/worktree preservation
needed at commit time must be recoverable and restored with its staging intact.
Tests use small records and logical boundary accounting, not large payloads or
disk fixtures. Root finishes build before guarded lint begins.

## Evidence and delivery

- Initial budget RED is a missing-module failure for the new internal ledger,
  not a claim of five behavioral failures. Original product evidence is above.
- Budget GREEN: 5/5, covering exact count/byte boundaries, repeated rejection,
  atomic admission and invocation independence without large allocations.
- Runtime RED: 26 tests, 25 fail / 1 pass; final 26/26 pass. One expected
  diagnostic was corrected to retain the existing `EFBIG:` prefix rather than
  changing product output to match a mistaken test expectation.
- Independent integration RED: 26 tests, 18 pass / 8 fail, covering admission
  across six modes, shared operands and admission-before-disorder precedence.
  Final independent integration passes 26/26.
- The six-file core-sort selection passes 116/116; six independent public
  controls verify check-mode iterator closure and falsey cancellation. These
  earlier runs included the unchanged user cut hunk outside the sort code.
- For exact-candidate validation, the user's staged changes are held in
  recoverable stash `807a0cfb99b754aaa5602a83dad6b709f3aa8653`, containing exactly
  three files with 33 insertions / 3 deletions. Full tracked-state recovery is
  also retained at `72c634c653eb1827c71635c0f579a788c5bd5549`. After implementation
  commit `47a8017df1aab4a215fad910aec79364776c1d27`, the original staging was
  restored and verified: helper/test blobs are byte-identical and the cut hunk
  content matches despite shifted line numbers. Recovery records remain retained.
- Without the user's staged edits, all maintained core-sort tests, text tests
  and literal integration-input controls pass 281/281 with no skips/failures.
  Exact-candidate `text.ts` SHA-256 is
  `1afcc7803c4330d1119b74a9166d1ed44d4a4c425b47a8fe0b7906bb5486143e`.
- Normal workspace build and root suffix stages pass.
- Current consumers pass the historical build-first route, three source groups,
  all 26 current groups and three expected-negative groups. The separate legacy
  source-audit issue #605 is not claimed clean.
- Built `virtual-bash` and `poe-code/safe-bash` imports pass 20 public checks,
  including actual 100,000-record acceptance and 100,001-record rejection in
  check mode. Largest input is 100,001 bytes; this is not a heap measurement.
- Full maintained lint passes: 9,703 configured/linted files, zero errors or
  warnings, followed by type and workflow checks. Build completed before lint.
- Frozen exact-candidate source/test/registration hashes remain unchanged.
  Local gates and implementation commit `47a8017df1aab4a215fad910aec79364776c1d27`
  are complete. #601 stays open until
  exact remote-main delivery is verified, then closes before publication.
- #600 is separately delivered and closed at the baseline. Its release is
  monitored while this work proceeds; delivery alone is not release success.
