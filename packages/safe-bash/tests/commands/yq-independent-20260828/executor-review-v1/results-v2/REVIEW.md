# Independent selected-composition review — August 28, 2026

Reviewer: DIFFERENT executor-framework verifier; ownership is results-v2 only.

## Verdict

The approved consumers-v2 selected-source correction satisfies the bounded
DATA/SYNTHETIC predicates reviewed here. No new composition/admission blocker
was found for the intended, already presealed 271-entry source projection.
This is not YAML acceptance, a trusted build, public integration, runtime-v2
acceptance, or authorization to execute a product candidate.

The initial review invocation remains **FAIL / exit 1**, not a green aggregate:
its reviewer postprocessor required an optional field that successful JavaScript
serialization omitted. Both owned Node workers had already exited 0, with all
raw observations captured. The separately presealed, read-only completion audit
exited 0 and verified those existing observations individually. It neither
reran the controls nor changed their expectations nor waived a nonzero child.
`POSTPROCESS-FAILURE.json` preserves the original failure; the scoped PASS in
`COMPLETION-RESULTS.json` describes completion predicates, not rescoring that run.

## Authenticated inputs

- Consumers-v2 preseal: `61cec1d71bf1121234de8ee727da990ff29c54e8`.
- Consumers-v2 correction: `90c4c50070334a34c1b75d78f7da25d302f6bb61`.
- Recipe SHA256: `69dfaf2aa833590312d80515a62d1dcc544952e55f9844aea73a3a8c2d90330b`.
- Admission packet: `71a16afd5b430175180fc4741531b75c31b25882`.
- Packet final-seal SHA256: `979cacf27eae6d3fc46980d35df17f8135274a4441f1d08d1f2768907b4cced3`.
- Independent execution preseal: `1dc3b2bc7fa200ee674504cecf86db152aac5085`.
- Read-only completion preseal: `fc411fbb60540aed3e46fe27c09d3e49658e5b32`.

Exact committed blobs, file modes, full recipe membership and expected raw
receipt hashes were authenticated before importing framework helpers. Copies
were regular files in owned TMP. Their Git object reader points explicitly to
the repository object database for immutable reads; it is not an implicit HEAD,
live-source, module, node_modules or product fallback. Existing packet trees
and all live/historical source files remained read-only.

The independent diff matched the recorded diff: behavior changes are confined
to selected-source admission; the remaining changes are explicit immutable-data,
import-path and provenance plumbing. Other guard and TYPE behavior, all 36
frozen operation/fixture bodies, and the verifier remain unchanged after that
enumerated plumbing. The receipt is not the source of addition/origin authority.

## Exact composition and packet

The selected map contains 264 baseline-scope entries: 263 from
`5137a74ec855a32d8a8860eb66b62eb44d11e290` and only the interpreter replacement
from `74361026502d76b8c2b696f9c60e410ac9b78d95`. Seven approved additions from
`35da18547ca82a67be9ca22b4adc21e3b8060780` make 271. Their descriptors and origins
were independently checked against manifest commit
`ef6032b210feb5cf19e6f6f94c40413740bef335`, not accepted from a caller receipt.

Source-map SHA256:
`e01d63d8e782cba59597da7c970cbd364a35582e4956ab04759064c756df1284`.

All 273 archive entries remain authenticated and preserved. The two additional
baseline data entries are `package-lock.json` and `scripts/typecheck.mjs`.
Packet preseal `7d235c03634d34c26a60be39dc970207fab18b30` already distinguishes
the archive from the original/moved 271-entry consumer projection. Actual
`assertSourceMaterialization` accepts both 271 trees and rejects direct 273
submission. That rejection is a correct unchanged guard, not an intended-input
blocker; no archive bytes were dropped and no guard was expanded.

- Source archive: 273 files; SHA256 `e4e6880a3622952b153a8261fec007908e1495584abf705ba2b150e95badcedc`.
- Full package: 870 files; SHA256 `2942ba1f6982a2e217350bbbad420e93d43e9336324b6db8a3d1d88b5a7aee4d`.
- Package map SHA256: `4ce4908953986584ae50f61976796d9ee7c1259e7c0d009afa4b675225496088`.
- Full package derivation: 846 authenticated baseline entries plus 24 authorized outputs, not a future hardcoded count.
- README: 36,273 bytes, mode 0644, SHA256 `87e92b73c7339b104212a9fb11006d339694f65575a7b79debfaa902ef9cf9d1`.

Consumers-v2 source receipt SHA256 is
`0b2a4bb3f6e7ff878f6c17f2237363811376edc1fbcdd5aa7499759705ecd170`;
packet source receipt SHA256 is
`cd0e2b94ea15e8199399d2cb589aee61a6c014785146dfec6b664ac0967130c9`.
The raw serializations differ; their parsed JSON meanings are equal. The full
receipt SHA256 is
`acd5644c6f148bd25d16af8c12a3e01b9319f682b3830ec5f8b19a23e6ae4a56`.
Expected hashes were authenticated from committed inputs, not self-report.

Five complete physical trees matched before/after maps, modes, membership,
regular-file checks and identities. Historical moved-directory device/inode
bindings still match and staging paths remain absent. This independently
checks the retained evidence and present identity, not a replay of the past
rename or a transactional guarantee. Both original/moved 870 package trees
passed the actual full-package helper without loading package code.

## Controls and raw evidence

- 25 independent admission/control observations: 25 matched, 0 mismatches.
- 36 frozen consumer guard operations replayed: 36 matched, 0 mismatches.
- No original 62-case framework mass rerun and no new YAML cases.
- Two known-owned Node groups, PIDs 24785 and 41041: statuses 0/0, reaped and
  groups absent before continuation; no signals, timeout or capture overflow.
  Recorded elapsed times are 35,988 ms and 928 ms; each had a 90-second deadline.
- Static completion process: exit 0; original supervising audit process: exit 1
  retained. Neither static checks nor negative controls add semantic YQ passes.

The 25 observations cover original v1 refusal, v2 and packet data admission,
wrong/fabricated/HEAD origins, wrong hash/mode/path/additions, self-authority,
raw receipt-hash mismatch, 271/273 boundaries, public-export pending status,
changed-driver rejection before execution, package guards and recipe mutation.
Temporary recipe bytes were restored and reauthenticated before continuation.

All 36 replayed operation bodies, fixtures and expectations are unchanged.
Only authenticated absolute helper imports, owned output paths and the
capture-before-compare wrapper differ. `REPLAY-BINDING.json` records whole-driver,
operation-block and replay hashes. The supplemental post-loop tool-tree audit
is omitted explicitly, not counted as executed or passing. Raw compiler-result
objects remain synthetic; no compiler ran. No opaque/escaped-descendant or hard
preemption guarantee is inferred from these two bounded workers.

## Preserved history and remaining gates

All 203 files present under this review tree at
`b93241dfb9983d2b660233bdddce4569ec803f89` remain byte-identical, including the
three prepared files. F01/F02 and the original 18-family results are unrescored.
The original `409449136ae1adc252ff6e205a6bb5785d113d0f` refusal stays historical
SOURCE_BINDING; the v2 selected-composition result does not rewrite it.
The packet's supplemental wildcard-audit exit 1 is also preserved as a
historical data-audit issue, not a semantic pass or an invented new blocker.

The packet remains BOUND_AUTHOR_BUILD: independentlyCompiled=false and
rootTrustedBuildReceipt=false. Public exports remain explicit pending
integration; direct module binding is not public proof. Runtime-v2 was neither
read nor executed. Its separately routed F01/F02/fence fixes, the compound
recipe/trusted build preseal, and loaded-code/type/public/product review remain
gated. Product imports, runs, builds, compiler runs and native YAML oracles: 0.

Attestation: this DIFFERENT verifier signs the bounded findings through the
explicit owned-path Git commits, not a claimed cryptographic/GPG signature.
