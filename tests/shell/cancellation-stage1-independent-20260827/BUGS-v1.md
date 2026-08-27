# Candidate findings v1 — root notification

Exact candidate `6747227230cd770379148552d471621717b766d7`; helper blob
`d5ceafef56a9351bd77630db66d9acfdc19a38ee`; helper SHA-256
`cde614b830e11f2040db65d2347c5f430df4b353324684585b2dc242ac733960`.
Both reproduced in initial isolated compilation and relocated internal ESM.
No product fix is authorized or made. Original red logs remain unchanged.

## F1 — P1, cancellation fanout truncation after one subscription detaches

Location: candidate `src/shell/cancellation.ts:197` (`notify`).
Independent reproduction: `cohort-v1.mjs`, H04b.

1. Admit an owned child with a native local signal.
2. Register callbacks A, B, C in that order.
3. A calls B's returned unsubscribe function, leaving the boundary open.
4. Abort the local signal.

Expected: A and C execute synchronously; only B was detached.
Actual: only A executes. `if (!subscriber.active || state.closed) break`
terminates the entire snapshotted fanout at B rather than skipping B.

This is not the reentrant-close exception: the boundary remains OPEN and C
remains subscribed. Ordinary synchronous fanout and independent subscription
detachment are the applicable contract. The same subscriber set holds child
lineage forwarders, so skipping a later live child can suppress its delivery
(potential cooperative-cancellation stall in a future integration, NOT a proven
current Shell stall). No claim that explicitly removed callbacks must execute.
Root should fix per-entry inactive handling separately from whole-boundary close.

## F2 — P2, control admission violates frozen first-delivered ordering

Location: candidate `src/shell/cancellation.ts:313`, especially line 319;
`admissionOrigins` enumerates configured controls in array order.
Independent reproduction: `cohort-v1.mjs`, H07b.

1. Configure budget control A then pipeline control B at a root.
2. Abort B with object reason B, then A with a different object reason A.
3. Attempt child admission using an options getter.

Expected under author freeze README: fail with EXACT B, the first delivered
control origin; do not read getter. Actual: getter correctly remains unread,
delivery remains B, but admission throws EXACT A (configured-first).

The author's frozen README says "then the first delivered control origin".
Its later RESULTS shortens this to "first control origin". This finding is
against the original explicit profile, not an invented ordering rule. If root
intends array order instead, that is a separately authorized profile change and
must preserve this original failure; do not relabel it as an initial pass.
Root/outer invoke precedence itself passed the independent cohort.

## Evidence

`evidence-v1/candidate-runtime.stdout`: 10 pass / 2 fail, 12 records.
`evidence-v1/moved-runtime.stdout`: same two failures, same 12 records.
These are source-behavior assertion failures, not fixture, import, or compiler
failures. No numeric/public command status or live invocation seam is tested.
