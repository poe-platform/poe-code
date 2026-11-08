# Final independent extension review execution

Final status: **FAIL** for exact candidate
`fe7083d99b8ccfdfbbb9b7209e0a6abbe7979724`. See `REPORT.md`, `coverage.json`, and
the read-only `verify-execution.mjs`. Preparation and every failed/corrected capture
remain separate. The candidate did arrive before the bounded preparation cutoff.

Owned new execution harness/evidence only. The reviewer is a different delegated
leaf, not the source author or freeze editor, and does not delegate. Production,
shared modules, root exports, author tests and both frozen cohorts remain read-only.

The initial phase reads frozen contracts, native receipts and baseline API Git
objects only. It does not infer acceptance from live author files, checkout dist,
the historical nonregex candidate or its 1381 author checks.

## Read-only default and explicit captures

`node tests/commands/expr-stress/extension-review/execution/review.mjs` checks every
original and extension freeze file against its original Git object and checks
both complete local subtree inventories, including added entries. No files are
written in default mode. This does not certify an append-proof whole repository.

`node tests/commands/expr-stress/extension-review/execution/review.mjs capture-native NEW-LABEL`
uses a unique OS-temp empty cwd and explicitly creates only new owned evidence
through apply_patch. It refuses an existing capture directory, authenticates the
original executable/archive/source hashes and archive source member, checks
Darwin kernel/architecture/macOS build, locale charmaps, version observations and
linked libraries, then repeats native calls sequentially with literal argv.
Each call has a two-second timeout, 64-KiB output cap, 128-argument and 8192-byte
input bounds. Child close is awaited; interruption closes admission and kills
the active native child. The scratch cwd is checked empty and removed. A missing
prerequisite records FAILED NATIVE QUALIFICATION, not a skipped pass.

Reports keep original95/104 GNU and separate104 Apple, extension-original20/23
GNU and separate23 Apple, and corrected1/1 GNU and separate1 Apple distinct.
Status/stdout/stderr are captured without rewriting the original receipt. Semantic
agreement means stdout/status plus diagnostic presence; exact diagnostic agreement
is another column and strict agreement requires both. Darwin-hosted GNU9.7 is not
Linux. Apple is not a fallback for failing GNU observations.

## Candidate staging, not acceptance

`node tests/commands/expr-stress/extension-review/execution/stage.mjs FULL-COMMIT NEW-LABEL`
requires the exact full commit in the author handoff and rejects the historical
nonregex commit. It archives that immutable commit into OS-temp, authenticates
source/build inputs, builds offline with recorded existing development tools,
packs, installs without scripts/offline, then moves the consumer into an unrelated
OS-temp parent. Source/dist from the checkout never supplies product acceptance.
The build tool link is development-only. Stage receipts include the original
handoff text/hash, archive/source/installed package hashes, inventory, exports and
all bounded process outputs. Staging does not execute or accept any product.

Candidate-specific declaration shapes, all limit names/units, validator and worker
seams must still be inspected and recorded from that archive before binding the
runtime adapter. The existing proposed API is not silently assumed. The installed
standalone `dist/commands/expr/index.js` file is not a package-subpath, default or
root export. An actual strict moved declaration consumer and restricted plainNode
runtime module inventory remain required, as do all frozen product controls.

`node tests/commands/expr-stress/extension-review/execution/watchdog.mjs` self-tests
the reusable two-second/64-MiB outer worker watchdog with a positive return, an
actual undefined rejection, and a deliberately stalled nonregex worker. A timeout
is recorded as failure and termination is awaited. Those are harness self-checks,
NOT the four original ReDoS controls or product worker-isolation evidence.

The 16 original safety specifications, seven Shell workflows, four ReDoS probes,
24 extension specifications and 32 wire mutations remain separate until executed
against the authenticated installed candidate. Baseline legacy grep/rg/glob
regressions and actual moved-installed transcripts are required, not replaced by
the preparation checks. Refusing supported native patterns is a retained semantic
gap, not an accepted workaround or a reason to shrink denominators.

## Primary facts consulted

On August 27, 2026, web.run opened official coreutils v9.7 `src/expr.c` and
`doc/coreutils.texi` from the coreutils/coreutils repository. In `docolon`, source
lines 560–596 use POSIX BASIC flags, compile before matching at byte offset zero,
choose capture-versus-length using syntactic capture count, return an empty string
for an unmatched first capture, and preserve result kind after overall no-match.
The authenticated archive source member is independently verified locally.
These facts do not prove general repeated-nullable capture-history or POSIX
leftmost-longest parity for any proposed implementation. No such parity is assumed.

The bounded wait starts with this review's first tool activity. If the author
handoff is still missing at the ten-minute ceiling, publish the preparation
checkpoint and stop. Do not continue polling or substitute another candidate.
