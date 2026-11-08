# Preseal preparation record

No qualification or product compiler/runtime invocation occurred during preparation.
Syntax-only checks passed for the initial v5 modules. The first read-only
prepare.mjs authentication stopped before emitting PINS: I had incorrectly
compared candidate:src (5876c6bf4ad9bc07f22cc46f8dbee99461981862, a tree) with
a1c95fc52ddeef2d753950b09dd2a26b44b4ab6e (the integration source COMMIT).
The actual assertion recorded expected a1c95fc..., actual5876c6..., at
auth.mjs:63 / prepare.mjs:18, Node22.22.2; pipeline exit2, no PINS written.

Read-only Git cat-file/show and the pinned author REVIEW-HANDOFF.json confirmed
integrationSourceCommit is the exact supplied commit, not a src subtree ID.
Before freeze, the mistaken preparation assertion was corrected to check that
exact handoff value and commit object type. Candidate tree and all357 selected
input object IDs/content hashes remain exact. No product input, fixture
expectation, predecessor evidence or authorized source identifier changed.
This preparatory authentication failure is not a v5 execution attempt or a
product result; preserve it separately from the single presealed invocation.
