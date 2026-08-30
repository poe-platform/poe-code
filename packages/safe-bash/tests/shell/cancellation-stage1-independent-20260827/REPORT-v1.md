# Independent private cancellation Stage 1 review — v1

## Disposition

**Not accepted against the declared frozen profile: two source findings.**
No candidate edits are made. This is a bounded independent private-helper review,
not a Runtime/Shell integration review, public API consumer gate, timeout feature,
global product gate, or superiority claim. Findings were reported during review;
root owns follow-up decisions. See BUGS-v1.md for exact repros and policy wording.

| Finding | Candidate location | Observed versus required |
| --- | --- | --- |
| F1, P1 | src/shell/cancellation.ts:197 | Detaching B during A stops fanout, incorrectly skipping still-active C. Boundary stays open. |
| F2, P2 | src/shell/cancellation.ts:319 | Admission chooses configured-first aborted control, not frozen-profile first-delivered control. |

Both failures repeat in exact-source emitted ESM and relocated internal ESM,
including the sealed-object replay. F1 is distinct from intentionally closing
the whole boundary during notification. F2 explicitly preserves the difference
between the author's frozen "first delivered" wording and later abbreviated
"first control" wording; changing policy would not retroactively pass this run.

## Identity and chronology

- Author freeze: `7023c28229ecb7939aee5eb7ca0f52ac57c795bb`; helper absent.
- Candidate: `6747227230cd770379148552d471621717b766d7`.
- Author evidence: `3d247da92459f8526afaea42c0ce25b59f3bd263`.
- Independent semantic freeze: `3af5da9650f36081b093e2158065a2226126ad37`.
- Candidate tree: `dbbe6732ddc4f383166876903d9a564039f5c4fe`.
- Candidate raw-commit SHA-256: `adb9733fd8a7b023b6221dae4ffbfc85cdbc377a996bcc0136fcc73df1414664`.
- Helper blob: `d5ceafef56a9351bd77630db66d9acfdc19a38ee`.
- Helper SHA-256: `cde614b830e11f2040db65d2347c5f430df4b353324684585b2dc242ac733960`.

The semantic freeze precedes implementation-body inspection and execution, but
follows the source commit. It is NOT a preimplementation freeze. Before freezing,
the reviewer saw author profile/handoff/baseline/build configuration and timeout
design prose. After freezing, the reviewer read declarations, implementation,
author fixture setup and case metadata. Exact exposure is recorded in FREEZE-v1
and CONCRETIZATION-v1. No other worker was spawned; no author suite was rerun.

Authentication verifies each raw Git object header/hash and committed tree path,
not just a checkout or a short hash. The primary seal holds 47 objects and 48
selected commit/path bindings. The supplemental parent/tree proof holds 50 raw
objects and independently reconstructs complete changesets: author freeze adds
nine files, candidate adds ONLY the helper, author evidence adds five files,
independent freeze adds one file. Unchanged subtrees compare by tree identity;
reconstruction does not require loose Git objects or a new branch. These are
partial reachable-object proofs, not full repository archives/ancestry bundles.

All eight author frozen fixture hashes match at freeze/candidate/evidence,
including the original missing-module BASELINE. Reserved cleanup/runtime/shell/
types source matches author freeze and design commit. Helper has no imports,
root export/package references, or runtime integration. Whole src/author-fixture
tree memberships are retained as metadata; only authenticated selected files
enter execution. Concurrent unrelated work neither enters nor vetoes the archive.

## Checks and limits

See RESULTS-v1.md and per-version raw logs. The independent cohort has 12 runtime
records for H01-H10, with two bounded variants and seven reason inputs inside H03.
H11 is strict typing; H12 is internal relocation. Repeats and parameter variants
are not extra independent obligations. Author's 38 literal cases, 22 runtime tests
and four type negatives remain AUTHOR counts and are never combined with ours.
Coverage overlaps the author profile; independent design/identity assertions are
not a claim that every obligation is previously untested or behaviorally disjoint.

Native-branded signals with an own undefined reason are explicit host fixtures;
ordinary abort(undefined) defaults to a DOMException. No arbitrary concurrent
signal mutation guarantee is inferred. No extra semantics for failed-subscriber
capacity release, forged reports, public invocation or cleanup mapping are assumed.

v1 source postchecks authenticated sealed bytes; v2 additionally inventories
actual copied compiler inputs before/after (including additions outside output),
copied tool bytes and moved declarations. Source inputs and fixtures stay fixed;
only declared emitted output is added. Local TypeScript and Node are regular
owned copies, no dependency install or symlink fallback. No external oracle.

Every Node child finished naturally; the 90-second watchdog never fired. v1 and
v2 scratch trees are enumerated and removed after sealing. Foreign status/index
snapshots are retained; both runs saw an empty foreign index. No full-suite sweep,
private-checkout access, source/export/package/AGENTS edit, new branch or user
change commit occurred. Only this owned subtree is authored and committed.

Measured capture window: 2026-08-27 22:44:34.176–22:44:45.380 UTC; replay window:
22:47:48.163–22:47:53.795 UTC. These are execution windows, not the whole review
duration, a 72-hour claim, or a performance benchmark.
