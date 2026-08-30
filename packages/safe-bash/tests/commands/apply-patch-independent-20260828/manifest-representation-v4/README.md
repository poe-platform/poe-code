# Versioned manifest admission repair and conditional actual review

Source/control preseal commit: `a90fa437047c1edacabcc3384b622179c84bf14d`.
Control seal SHA256:
`8f327bead14593184c9f984795c9034c9d7fa0a64652bbf4cd22937499cf2293`.

The single presealed DATA/SYNTHETIC attempt passes **31/31**: 22 unchanged
controls, ROOT-approved D02-v2 exact30 plus authenticated ID membership, and
eight new source/admission controls. Original `569a4b89` 22/23 and its wrong10
expectation are untouched. This is a new cohort, not a rescore.

Owner320/child323, natural child exit0, close and exact PID absence observed;
17,384ms, total peak2. All 3,751 observed stdout/stderr bytes retained. Eight
complete artifact files total 1,020,857 bytes with exact hashes/modes/membership
in EVIDENCE-MEMBERSHIP.json. The one loaded module is an inert stub, not a
product; no candidate build or runtime is credited to these controls.

## Two repairs

`publishRuntimePair` measures BUILD-RECEIPT and normalized RUNTIME-SEAL, admits
both full Git blob frames plus a bounded 65,536-byte commit-payload reservation,
and jointly admits artifact bytes plus framed capture against remaining capture
before either serialization or publication. It then publishes both records.
The existing 16MiB administrative/parser cap remains unchanged. Before fetching
actual committed objects, a serialized Git --batch-check authenticates exact
sizes; commit payload must fit its reserved maximum, and exact whole framing is
checked again. This is not an atomic two-file or Git-publication guarantee.

Every graph ID resolves only to the exact base package or its fixed approved
overlay hash. Authority covers base plus the 30 phase-specific graph IDs derived
from immutable variant bindings, including complete contents/modes/result hashes.
Generic source/consumer inventories cannot substitute for graph manifests.
Changed, shortened, same-shape and ID-swapped graphs refuse before module load.

The data/stub controls exercise these paths, including build-overcap and mixed
batch zero-write counterexamples, retained dangling/cycle/catalog checks,
successful pair readback, and syntax/identity checking of every executable
source body. They do not replace actual compiled/installed/moved product review.

## Complete fresh full54 preseal

`../candidate-753-review-executor-v2/PRESEAL.json` SHA256:
`d75db6e78b9a891705c8d8ffd753ef54624df4bb64b1670a523ecb365290e364`.
ALL-SOURCE-PREFLIGHT.json records successful authentication of all20 executor
files, all80 external named bindings, both pinned executables and all three
tool-directory inventories, with the original54-job membership unchanged.
The preseal is committed before any actual source build or product load.

Candidate: `753f33d2fa1a2ccd86089c563d4ad66b9a1ae26d`.
Derived tree: `6a59ca403c5411344dea2ee057909ba179bf7043`.
Full882 package SHA256:
`f04afbf9230fd9e3275f83c7dab26837aeb618bd6178f4ac0b794b93302d6d95`.

The conditional ROOT authorization is for ONE fresh full54 execution: fresh
setup/build rather than replay of the removed old scratch, no inherited product
passes. Profiles include original32+80 plus63 author rows per layout, four
versioned fixture rows per layout, U01–U12 across three layouts, I01–I04 across
their instrumented graphs, 15 type jobs, 18 limit endpoints, two adapters and
six loaded original-mutant triplets. Exact counts remain runtime obligations,
not passes claimed from this plan.

Bounds:110min including cleanup,70 all-owned processes,peak4 total,128MiB
combined capture,512MiB work,case30s/build120s. The flat controller plans62
owner/child processes including the added runtime-sizes Git child. The grant
materializer and developer archival calls must be reported separately rather
than hidden in that planned62. No scripts-enabled install, native oracle,
private repository, network, production source, root exports or defaults change.

After this exact preseal commit, `seal.mjs grant <full-source-commit>` performs
the final binding check and atomically/fsyncs the phase-bound ROOT-GO.json.
It reports the literal `exec -c` pinned Node controller command, cwd and
login:false. That exact command is the only actual launch; safety, capture,
integrity and unknown-retirement failures stop without retry. Ordinary safely
closed assertion failures may aggregate.

## Historical evidence remains separate

`685cdd0d` remains consumed HOLD3/54/51 unrun with131,072 irrecoverable unretained
observed bytes. `5f336d1a` remains binary-output HOLD with380,995,389 tool-reported
omitted bytes and unknown exact raw counts. The committed historical manifest
DATA roundtrip is not raw-output reconstruction. Original882/274/30 membership
proofs, all older HOLDs and all failed expectations remain immutable.
