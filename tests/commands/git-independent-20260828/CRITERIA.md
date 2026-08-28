# Independent Git design review criteria

Status: Completed design review; decisions proposed, no implementation GO.
Implemented Through: Not applicable.
Review date: Friday 2026-08-28, America/Chicago.

## Timing and scope

The assignment supplied the criteria before inspection. This written record was
made **after** reading the author's packet and inspecting selected sources and
official documentation, not as a blind or pre-author preseal. Initial metadata
inspection preceded the 11:38:10 CDT timestamp; binding capture was
11:38:59.992 CDT. The matrix is an independent, post-design, pre-implementation
scenario freeze, not secretly held-out executable fixtures.

Subject: commit `589d1d93e2cd87296949ff32d8bf4d9bbef6cbcc`, exclusively
`tests/commands/git-design-20260828/**`. Ownership for this reviewer is exclusively
NEW documents in `tests/commands/git-independent-20260828/**`. Current applicable
parent/repository instructions were read, including repository AGENTS.md:34 and
AGENTS.md:154; no applicable nested AGENTS was found. No instruction copy is made.
The write-spec skill and its style reference were read for evidence/decision
discipline. This is an audit, not a competing authoritative specification; its
checker was not run because the assignment forbids helper execution.

## Decision criteria

1. Preserve the user-supplied Git priority (117897; 8.73%), useful read-only M1A
   loose/index workflows, and M1B pack/delta before ordinary packed/default readiness.
2. Authenticate stored objects and source bytes. Recompute derived tree identities
   from authenticated constituents without demanding storage of derived-only hashes.
3. Separate actual format contradictions, incomplete M1 decisions, deliberate
   project restrictions, and future M1B acceptance. Do not demand full Git.
4. Require explicit unsupported-storage/content refusal, not false clean, omitted
   packed objects, lossy content decoding, or fabricated native/provider semantics.
5. Check exact finite defaults, override ceilings, cumulative accounting, admission
   before owned growth, byte ownership, cooperative cleanup and parent authority.
6. Assess existing zero-runtime-dependency building blocks by reading, not by
   importing them or treating private APIs as approved shared contracts.
7. Freeze finite future cases, distinguishing six prepared expectations from
   semantic coverage and independently authorized future native qualification.

## Execution boundary

Permitted work actually used: development Git metadata/show/cat-file/diff, source
reads, official web reads, in-memory literal-data checksum/structure inspection,
and the final explicit-path documentation commit. No product imports, tests,
builds, helper runs, native Git version/oracle commands, fixture repositories,
private checkout access, network product routes, or gate/declaration replay.

The literal-data inspection used Node crypto/zlib with small input/output guards;
it did not benchmark or establish a product decompressor. Documentation examples
were not executed. Host reads were confined to assigned repository evidence and
the explicitly requested applicable instruction/skill files.

## Completion boundary

REVIEW.md gives actionable root decisions; MATRIX.md contains 72 future scenario
rows, all UNRUN. SOURCES.md identifies actually accessible primary sections and
the unsuccessful documentation lookup. BINDINGS.json records data authentication
and protected-input checks. Completion means this bounded review only; no parity,
performance, public/default registration, service acceptance, full project gate,
or 72-hour work claim follows.
