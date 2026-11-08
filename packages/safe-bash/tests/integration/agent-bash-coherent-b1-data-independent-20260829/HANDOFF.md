# Independent B1 recovery audit: reviewer admission HOLD

August 29, 2026. DATA review only; no campaign or product acceptance.

## Exact failure and diagnosis

Preseal commit: `215d178c142d8461f46d643378f66cb87d05181f`.
The sole permitted DATA helper stopped at `review.mjs:16` before manifest
authentication or control execution. It incorrectly compared the author commit's
root tree against the supplied recovery-packet subtree identity.

- Author commit: `48dca5c3d1cae85faaed22db0e6e358abdd1f975`.
- Actual commit root tree: `2eec40065a75caf8f4f0b37c1025ce4b6e8f9abf`.
- Correct packet subtree: `86c0a0693ba0371ad9b8dbc292ad6711874b8ffd` at
  `tests/integration/agent-bash-coherent-author-20260829/b1-data-recovery-v1`.
- A subsequent scoped `git ls-tree` of that exact commit returned the supplied
  subtree identity. This establishes the mistaken reviewer locator, not a
  recovered-data integrity failure.

`REVIEW.stderr` and `git-tree.stdout` preserve the original assertion and root
tree result. The helper was not edited or rerun. Its planned second Git child,
manifest/copy authentication, original-source postguards, extracted author
controls and novel controls were never reached. There was no candidate import,
runtime replay, Worker, compiler, npm or native oracle execution.

## Result accounting

- Six author DATA controls: **0 executed, 6 UNRUN** in this review.
- Three novel copy/namespace controls: **0 executed, 3 UNRUN**.
- Claimed 34 files / 1,380,268 bytes: not independently authenticated by this run.
- Claimed 15 cases (C10/C11/C15/C16/C18 across three layouts), 15 Worker
  create/exit records, four closed runtime children and preimport exit78 were
  inspected in author summaries only; raw derivation remains UNRUN here.
- No independent PASS/FAIL case matrix is inferred from those summaries.

Original publisher HOLD remains unchanged. Literal Worker exit1, runtime-child
stream EOF UNOBSERVED, controlled-release limitations and incomplete universal
OS census are not repaired by copying DATA or by this tree-locator diagnosis.
Local-a independent `42530f28` remains HOLD; Faraday owns its repair. This review
does not modify runtime/local source or remove that final-build blocker.

## Capture, process and continuation qualifications

The sole DATA helper exited1; its one Git child exited0. All observed operations
returned, with no remaining managed session. Eighteen known starts had returned
before this publication operation; patch and final publication reserve six more
known starts, for a prospective total24. Final tool results must establish the
actual publication count; this is not a universal transitive-process census.
Original deadline: `1788023728.525712` Unix seconds. No fresh runtime authority
is inferred from remaining time. No cleanup of previous evidence occurred.

Scoped diagnosis capture is retained at
`/private/tmp/safe-bash-b1-data-independent-tree-diagnosis.stdout` and `.stderr`.
The original preseal, helper and failed captures remain literal. A follow-up
requires a versioned reviewer admission that binds the packet subtree separately
from the commit root, checks actual manifest/identity schemas, and a fresh grant
for one DATA helper. No author repair is established or requested by this HOLD.
