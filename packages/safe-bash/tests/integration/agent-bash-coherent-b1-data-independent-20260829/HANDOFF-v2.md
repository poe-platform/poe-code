# B1 DATA continuation: reviewer admission HOLD

August 29, 2026. No product execution or campaign acceptance.

## Prior publication resolved from retained bytes

The original commit **6ec28c4af9a618f43aeb7f70115628c9041ee961** succeeded.
Its retained stdout records `publication_status=0` and publication time
1788023610.6875169277, before the old deadline1788023728.525712. Scoped status
emitted no dirty rows. The subsequent `print -u 3` forwarding failed because that
descriptor was unopened; the separate stderr preserves eight such errors.
Neither the primary commit result nor the forwarding failure is rewritten.
Original preseal215d178c and all original admission failures remain unchanged.

Read-only receipt paths:
- `/private/tmp/safe-bash-b1-data-independent-final-commit.stdout`
- `/private/tmp/safe-bash-b1-data-independent-final-commit.stderr`

## This attempt and exact blocker

The inspection helper authenticated MANIFEST.json against the supplied SHA256
`a0761e51f84c875dd13e2909251be80f0073eb97432f7265ee521a9d98f27551` and inspected
actual schemas: each identity JSON is the whole manifest row, not just `source`.
The controls/audit helper then stopped at review-v2.mjs:22, before blob or copy
authentication, because `git ls-tree -r -t -z --full-tree COMMIT -- PACKET`
also emits ancestor tree entries. Its first record was `tests`, which the
reviewer's packet-descendant-only guard rejected. This is another reviewer
metadata-admission defect, not an author DATA-integrity defect.

The unchanged captured NUL inventory explicitly contains:
- `tests`: tree425edaab94173e7af5c1a0f9366fe677a78c62f6
- `tests/integration`: treeb8713dca97339039d01d95a05f3abb2050d48918
- author directory: tree001386b78a51f6607da9af2e1c12aee6c0b5a276
- recovery packet: **tree86c0a0693ba0371ad9b8dbc292ad6711874b8ffd**

These records came from exact commit48dca5c3d1cae85faaed22db0e6e358abdd1f975.
No incorrect root-tree expectation remains in the new helper; the new failure is
ancestor handling. The fresh-binding Git command was never started. Future
admission must either verify the three exact ancestors before filtering them or
use an authenticated explicit commit:path subtree inventory, not broaden a path
allowlist or infer missing bindings. No retry occurred in this continuation.

## Counts and limits

Two file-based DATA helpers executed: inspection exit0; audit exit1. Exactly one
Git metadata child was started by the audit and returned0. Both helpers and all
observed children returned. **Six author controls and three novel controls are
all UNRUN**, not failed product checks. All 34 copied-file/raw-mode postguards,
the 15-cell raw outcome derivation and fresh7e5502a authority cross-check remain
uncompleted. The original author summaries are not independent acceptance.

Eighteen known process starts had returned before this handoff patch; patch and
publication reserve six more, at most24 total. This is invocation-local known
administration, not universal transitive-process accounting. No Worker, runtime,
compiler, npm, native oracle or source edit occurred; no controls directory was
created. The new prospective deadline is1788024110000ms. Final publication raw
records provide the actual final time/status; only an opened FD is forwarded.

Original B1 publication HOLD, literal Worker exit1, runtime-child EOF UNOBSERVED,
incomplete original OS census and local-a independent42530f28 HOLD stay intact.
Runtime/local source remains Faraday-owned and untouched. No cleanup occurred.

## Preserved evidence

- `REVIEW-v2.stderr`: literal second admission failure; stdout is empty.
- `v2-git-inventory.stdout`: exact NUL-delimited Git inventory; stderr is empty.
- `/private/tmp/safe-bash-b1-data-independent-r2-inspect.stdout`: first helper's
  manifest/schema/source observations; matching stderr is empty.
- `/private/tmp/safe-bash-b1-data-independent-r2-inspection.stdout`: recovered
  prior publication receipt and initial clean owned status.

Disposition: **HOLD for incomplete independent DATA audit**. No author repair is
established. A fresh controls invocation would require renewed authority; this
report does not silently expand the exhausted two-helper allowance.
