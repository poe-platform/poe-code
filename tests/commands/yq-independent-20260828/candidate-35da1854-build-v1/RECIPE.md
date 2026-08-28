# Part A: one independent scoped build

Date: August 28, 2026. This additive scope does not modify candidate-35da1854-v1.
Current user/root authorization activates BUILD ONLY after accepting composition
`7ed356ade4509e492e15615587408eb4b41f92e0` and runtime/integration review
`6af0eb2d627f3ed80255c295b79299708436d372`. Their historical no-GO language and
failed postprocessor aggregates remain intact; this new authorization is not
backdated into those reports. No source bug is inferred from those failures.

## Authority and exact inputs

The immutable packet is `71a16afd5b430175180fc4741531b75c31b25882`, final seal
`979cacf27eae6d3fc46980d35df17f8135274a4441f1d08d1f2768907b4cced3`.
Candidate source is `35da18547ca82a67be9ca22b4adc21e3b8060780`, evidence
`ef6032b210feb5cf19e6f6f94c40413740bef335`, handoff
`bcec1ead34aee37c8fe574b248a8242ad4f60cfa`. The source is baseline 5137 plus
accepted length 7436 and the seven explicitly enumerated YQ/query-adapter inputs,
not the entire source commit. Exact full revisions, file identities, paths and
toolchain identities are in INPUTS.json and the accepted packet.

Authenticate consumers-v2 `90c4c50070334a34c1b75d78f7da25d302f6bb61`, recipe
`69dfaf2aa833590312d80515a62d1dcc544952e55f9844aea73a3a8c2d90330b`, before
loading its source-admission helpers. Runtime-v2 source/evidence are
`7add5d2c0a3acb27483ba0bb5dd52385812d8ed7` /
`70fa3df66f9c8dc3f972cfa8c0c5862d77d7514e`, recipe
`fc273904cf20f4a717bb7350bb46046bbee16617aee371bcfd03e38d98920f15`.
Integration-v2 source/evidence are `4fafd93a2a414fe9ce1965f77ab45da1d417d10a` /
`83035d641c415019ac62a0d0114cf2836ba77e45`, seal
`47c3874f520efee18062d4b2e687159a52039a86d35945a7f5371e85eb00fdff`.
Runtime/integration code and cohorts are not executed here.

## Preparation before compiler execution

The preparation mode only authenticates data/helpers and creates regular copies.
All 271 source-projection files are copied to a new canonical directory outside
the repository. The 273-entry source archive, including package-lock.json and
scripts/typecheck.mjs, remains a separate retained original; neither file enters
the already approved 271-input compiler profile. All original/moved source and
870-package copies, raw artifacts and old packet are rechecked before and after.

Authenticate the selected Node v22.22.2 executable, TypeScript 5.9.3, @types/node
and undici-types using the already accepted complete-tree pins. Copy all compiler
and type-tool files, plus the exact Node executable, to a separate regular tools
tree. No symlinks, hardlinks, AGENTS files, downloads, dependencies, npm or private
paths are admitted. Do not change source/configuration/tool bytes or existing
materializations. INPUTS.json records complete copied-tool maps and both source
and tool identity algorithms. Archive/source/package membership is not inferred
from counts.

After preparation, commit BUILD-PRESEAL.json binding this document, the runner and
INPUTS.json. Only then invoke the one run mode with the independently supplied
preseal digest. A newly created ATTEMPT-STARTED.json forbids a second attempt.

## Exact compiler profile and bounds

Use precisely the deferred command in the old PRESEAL.md, substituting the pinned
paths recorded before execution:

```text
PINNED_NODE PINNED_TYPESCRIPT/lib/tsc.js --project SOURCE/tsconfig.build.json --outDir FRESH_OUTPUT/dist --typeRoots PINNED_TYPES/types
```

cwd is SOURCE. Both tsconfig files are unchanged. The existing build profile is
ES2023, strict NodeNext, declarations/declaration maps/source maps, src-only input,
skipLibCheck true. No global typecheck, author tests, consumer types, semantic
vectors, product import or product execution occurs. No instrumentation, compiler
API wrapper, additional CLI flags, or type-policy relaxation is used. Environment
is exactly the small map in INPUTS.json; NODE_OPTIONS/NODE_PATH and ambient npm
configuration are absent. HOME and TMPDIR are fresh owned directories.
The inherited umask is explicitly pinned to 0022 before preparation and execution.

One owned detached compiler process has a 120,000 ms deadline, 2,000 ms TERM grace
then KILL only to its own known group, and a 5,000 ms reap-observation bound. Each
captured stream retains at most 4 MiB; overflow is failure, not truncation-as-pass.
Tree checks bound individual files at 16 MiB, trees at 64 MiB and 4096 entries;
the independently hashed Node executable is separately bounded at 128 MiB.
These are harness bounds, not a hard-RSS/sandbox/escaped-descendant claim.

Record raw stdout/stderr, PID, exact command/environment, wall/monotonic timing,
exit/signal, termination events, close/reap and group absence BEFORE asserting
compiler success. Every nonzero exit, signal, overflow, spawn/timeout/reap error
is FAIL; retain partial outputs and stop without retry. An invocation/fixture
mistake is reported for a separately authorized additive preseal correction,
never waived or silently repaired here.

## Output comparison and explicit map relocation

Expected output names come from the accepted complete 870-file package map:
868 compiler outputs plus unchanged baseline README.md and package.json.
Every selected .ts source must account for its .js/.d.ts and two map files.
Compare raw .js and .d.ts bytes exactly. Preserve every raw compiler output.

The already sealed map relocation is the only permitted transformation. Require
each raw map to have exactly one source, empty sourceRoot and the compiler's
unchanged compact JSON serialization. Resolve its sole source against the raw
output directory and require the corresponding exact selected SOURCE/src input.
Rebase only that sources element to the package-relative path from dist/... to
src/...ts. Preserve all other fields and serialization. Verify resulting complete
bytes against the independently expected author map, recording raw and relocated
hashes per file. Raw-path differences remain differences; this is not a claim of
raw compiler map equality. Any other mismatch remains FAIL and is not normalized
away. No production change or output copied from the author can repair a mismatch.

Only if every expected output truly matches, copy the independently emitted bytes
and explicitly relocated maps into a fresh full package, then add README/package
metadata from the authenticated source. Verify all 846 baseline entries plus all
24 additions and complete directory modes. Serialize in the immutable packet's
entry order using its already sealed USTAR recipe: mode 0644, omitted owner/group,
mtime 499162500, npm octal spelling, two zero terminator blocks. Exactly one gzip
level-9/default-strategy/memLevel-8/windowBits-15 attempt sets OS byte 255. Compare
raw package SHA-256 to
`2942ba1f6982a2e217350bbbad420e93d43e9336324b6db8a3d1d88b5a7aee4d`.
The retained source archive remains bound to
`e4e6880a3622952b153a8261fec007908e1495584abf705ba2b150e95badcedc`.

## Receipt and handoff boundary

Emit new immutable per-file comparisons, raw capture/process receipt, complete
independent package map, build receipt and independently expected hashes. Before
proof, package provenance is AUTHOR_ARTIFACT_BINDING_ONLY. Success may establish
INDEPENDENT_SCOPED_BUILD_WITH_EXPLICIT_SOURCE_MAP_RELOCATION, but does not rewrite
the old BOUND_AUTHOR_BUILD receipt or claim root acceptance of a new receipt.
The fixed integration-v2 binding still pins the old author receipt; do not patch
it or pretend that it dynamically accepts this new evidence. Root/other reviewer
must route the additive proof explicitly. Full new consumer-receipt schema stays
unchanged; no consumer or runtime API is modified.

Seal only this new owned directory with explicit-path atomic commits. Publish
/tmp/yq-build-independent-ready.txt and stop. Actual semantic/type/moved/lifecycle
review belongs elsewhere. No public YQ exports or global typecheck green is claimed.
