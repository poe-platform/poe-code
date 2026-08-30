# M1B v2 Prelaunch Review Specification

Status: Accepted for one scoped execution, not product acceptance

Implemented Through: `64d76feb39275e4fa9d7e820c02eb48aaa68849b`

Purpose: Qualify the selected executor corrections and bindings before the
already-authorized finite independent review.

## Normative Language

MUST and MUST NOT identify the already-authorized review requirements, not new
product behavior. The reviewer MUST preserve historical failures and MUST NOT
count source inspection or case mappings as runtime passes.

## Problem Statement

The earlier executor has three source-level launch defects. This additive
review checks their corrections and the exact selected component composition.

## Goals and Non-Goals

The goal is one safely bounded independent review of the frozen candidate.
Production editing, native Git parity, resource-limit relaxation and unqualified
codec observer acceptance are outside scope.

## Source and Evidence

The delegated reviewer inspected the source changes directly after the existing
component workers finished. No additional agent was launched for this review.
Product author Curie, runner author, and this reviewer are distinct participants.
The original runner review `adecd04c56790e3acfccaf0c3216e0a606b47e14` and its
three SOURCE findings remain historical; this is a successor, not a rescore.

Source-only check `b3c40a40` completed once: 55 selected files, seven stored
origins and 55 stored blobs matched. Eight sequential Git metadata children
returned zero with known retirement. The result was captured after 354.011 ms,
with 1,873,769 bytes captured before the final result. No candidate, compiler,
fixture, npm, native oracle or private code ran. Exact raw output is retained in
`observations/`; this does not replace later 282-source/910-package admission.

Recipe SHA256:
`a4c3fab089d7c2a957f4d263298a153b7cdea3d856c9820b5c90f6b0f2d591a6`.
Final-seal SHA256:
`d23931c1dcf4127cc075a99e603c6a78e5a509a8feff084cd4599137b6f5d309`.

## Test and Validation Matrix

| Obligation | Inspected source and conclusion |
| --- | --- |
| RS-F01 startup | `runner/v2/outer.mjs` establishes owned raw streams before receipt/source admission, counts the coordinator and notified descendants, and records final status/retirement. Initial trusted capture-directory acquisition remains distinct from target admission. |
| RS-F02 phase clocks | `coordinator.mjs` checks the outgoing phase's observed elapsed time and checks the active phase again in finalization. Later phase deadlines do not erase earlier overruns. |
| RS-F03 case lifetime | The batch deadline is selected before preparation. `supervisor.mjs` checks observed close, capture and retirement publication; `cases.mjs` checks final guards/deletion against the same deadline. These are observed deadline checks, not hard scheduler preemption. |
| Ordinary failure | Nonthrowing checks retain failures. CASE_END follows raw capture and registered cleanup; fresh candidate/harness/control/case guards precede continuation. Escaping setup, capture, integrity, abort or unknown cleanup prevents continuation. Failed worker status remains aggregate failure. |
| Type integration | `type-bridge.mjs` adopts exact raw/result publications before predicates, verifies the request/fixture/tool/subject/read closure and actual process outcome. Compiler-API diagnostics are not fabricated CLI statuses. Five original fixture templates remain unchanged; different component review `5f937ee1` is retained. |
| Mode correction | The active projection uses exactly the two `semantic-mode-v3` substitutions: full regular-file type plus declared permission bits, and exact directory mode. Raw stat values and 104 cases/56 controls remain unchanged. |
| Loaded controls | CRC, OID and intrinsic-depth witnesses retain pristine prerequisites. The runner requires the actual loaded target hash, restores original bytes into the same isolated mutant root after known retirement, and uses a fresh worker. Hash denial, timeout or unrelated failure is not kill evidence. |
| S01 mechanics | Private reservation/allocation exception injection and exact old-artifact/counter mutations remain explicitly instrumented mechanical roles. They do not establish native allocation failure or public limit reachability. |

Selected execution membership is explicit, not a mutable-parent-tree scan.
Unrelated inert siblings are excluded; active assembled paths, modes, bytes and
imports remain guarded. All product inputs stay on source
`fca6f81d2d96db2bbceabf3247cd57ffe240bde6`, derived tree
`23074ef0c443ca618c4f26204b5f3d2274b86895`, package
`cc0e75c2d0d12f713f0458e608ddeae157cf3432b4e0b48277a329a98115aa1a`.

## Finite execution profile

The plan has 140 IDs/274 calls: 208 stock, 32 private mechanical, ten type,
six earlier loaded and 18 additional loaded calls. These are planned calls,
not passes. Fifty shared 30-second batches plus ten compiler-API descendants
and setup/build/install produce 64 children below the outer process, 65 total,
peak four. A sequential routing-metadata process adds one start, never an
overlapping fifth process. The eight completed source-review children are
preparation, separately reported rather than hidden in runtime totals.

The capture proposal sums exactly to 255,852,544 bytes (244 MiB); the
conservative logical working-file ceiling is 710,937,937 bytes. The original
7,200-second clock includes startup and cleanup; build remains capped at 120
seconds. No per-layout reset, retry, extra allowance or hard RSS claim follows.

Two semantic layouts are promised: independently compiled selected source and
the full offline-installed, physically moved package. Installed-unmoved is only
the admitted movement origin. Direct Git module tests are not root-export proof.

## Conformance Criteria

The prelaunch source review is complete only for the exact identities recorded
here. The runtime MUST stop on unsafe capture, integrity or unknown retirement;
ordinary assertions MAY aggregate only after known cleanup and passing guards.
No candidate acceptance is inferred before its captured actual outcomes.

## Remaining Limits

All actual candidate/build/type/control cases are still UNRUN at this seal.
The 38 format rows, 32 resource rows/108 variants and B01–B12 retain their mapped
roles; mapping is not complete runtime coverage. The six virtual workflows are
planned Shell cases, not native Git oracle evidence. H09's codec adapter remains
unqualified; S02 remains SOURCE_CONCERN/UNRUN. No cleanup count, allocation/RSS
claim, M1A outcome or author 663/12, 699, 744 result is inherited. Actual unknown
owned cleanup, integrity/capture failure or unknown retirement stops the single
review without retry. No production changes or integration are authorized.

The first documentation lint returned seven missing specification-format
errors; it did not execute the review or candidate. Its raw messages are
preserved in `DOC-LINT-ORIGINAL.txt`. This format-only successor does not rescore
that lint attempt or change executable requirements.
