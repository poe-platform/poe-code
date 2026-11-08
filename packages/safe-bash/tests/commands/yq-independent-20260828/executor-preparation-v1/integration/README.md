# Final bounded compound YQ recipe — August 28, 2026

**PRESEAL / SYNTHETIC ONLY. Do not execute a candidate from this preparation.**
The root must route the completed recipe seal, different framework review and
candidate-admission handoff before the deferred entry can run. No unsealed
candidate worker output is read as authority. Runtime and consumer trees remain
unchanged; this is an additive wrapper, not a product framework replacement.

## Fixed components and artifacts

- Runtime source `c49d494dd5a36b19198680239a72e0c95cb90d8d`, evidence
  `ee9d0c1fd24b33aa918154eb379a92c02cfe5925`; recipe-seal SHA-256
  `2fce675f035a2ad39c2e2e2ee9d54e2762a531383e70507149993268acedb7e8`.
- Consumers `409449136ae1adc252ff6e205a6bb5785d113d0f`, preseal
  `21ad8c589d7f138064616e8f37e748e6a2e7c200`; recipe-seal SHA-256
  `24e28a529cec877b82835d81ba3f274702a28d43ab5285754b7bd1ef0b82f98d`.
- Author source `35da18547ca82a67be9ca22b4adc21e3b8060780`, evidence
  `ef6032b210feb5cf19e6f6f94c40413740bef335`, handoff
  `bcec1ead34aee37c8fe574b248a8242ad4f60cfa`.
- Exact source archive SHA-256
  `e4e6880a3622952b153a8261fec007908e1495584abf705ba2b150e95badcedc`;
  full870 package SHA-256
  `2942ba1f6982a2e217350bbbad420e93d43e9336324b6db8a3d1d88b5a7aee4d`.
- Baseline `5137a74ec855a32d8a8860eb66b62eb44d11e290` plus accepted length
  `74361026502d76b8c2b696f9c60e410ac9b78d95` and exactly seven new YQ/private
  query-adapter source paths. Mutable HEAD is never the source authority.

`core/COMPONENTS.json` contains compact selected-byte bindings. `core/RECIPE.json`
is the execution/role routing authority; `PROTOCOL.md` specifies the compound
boundary, not new YQ semantics. `SEAL.json`, supplied after source sealing,
authenticates exact core membership, contents and modes; evidence is outside it.

## Exact schema composition gaps

1. **Raw author Git tree is not the consumer source identity.** A read-only
   `git ls-tree` of 35da1854 over the consumer's exact selectors reports **301**
   paths; the accepted consumer baseline 264 plus seven author additions is
   **271**. Thirty extra paths include unrelated timeout/XAN metadata/modules
   and YQ DESIGN.md; no such code is imported here. `authorizeSources` correctly
   rejects that raw commit. Do not loosen it, widen source additions or silently
   replace the candidate with HEAD. Root may route an explicitly accepted
   immutable **composite Git object** whose entire selected tree is exactly the
   271-file map. Its different Git identity is recorded as
   `consumerCandidateCommit`; the author source identity stays 35da1854. The
   wrapper checks every new path against the author manifest and every baseline
   entry against the sealed consumer map. No composite Git object is created or
   inferred by this preparation. If root cannot supply one, the minimal needed
   next version is a separately reviewed consumer source-admission adapter for
   per-path immutable provenance instead of one full candidate tree. V1 remains
   unchanged, and this integration will refuse rather than bypass its capability.
2. **Two explicit source views.** Author archive source has 273 files. Consumer
   source admission covers 271; exactly `package-lock.json` and
   `scripts/typecheck.mjs` distinguish the views. Both must be materialized,
   separately guarded and remain read-only. The 273-file archive is never
   silently trimmed and relabeled full-source proof. Consumer source checks are
   not a build or replay of that archive.
3. **In-process materialization capability.** A consumer binding cannot be
   serialized and resurrected in another child. Each moved command, loaded-code
   control and type worker therefore uses a fresh whole-package copy/physical
   move and its own enrolled capability. Existing/moved trees and all previously
   completed copies are rechecked before/after subsequent admissions. This is
   deliberately more work, not a claim of optimized performance. At most 151
   moved copies and 1 GiB of their package bytes are admitted. No illicit binding
   reconstruction or dual import-hook stacking occurs.
4. **Type/build limits.** Six direct declaration fixtures are eligible; five
   public-only fixtures remain `PUBLIC_EXPORT_GAP`. `runDeclarationConsumers`
   captures compiler output as UTF-8 text; this wrapper does not claim arbitrary
   invalid-byte compiler fidelity. There is no build API in either component;
   candidate admission/reproduction must supply the build receipt separately.
   A new build recipe is not invented. Global typecheck remains unrun because
   unrelated unclassified `.mts` inputs are not this feature's responsibility.

These are concrete binding/resource limitations, not unsettled YQ policy and
not permission to mutate sealed components while their reviewer works.

## Deferred root envelope

Future invocation (documentation only; **not executed now**):

```text
PINNED_NODE core/run.mjs ROOT.json TRUSTED_ROOT_SHA256 SEAL.json TRUSTED_SEAL_SHA256
```

The exact top-level keys accepted by `validateEnvelope` are:

| Field | Required value |
| --- | --- |
| `schema`, `purpose`, `execute` | `1`, `YQ_COMPOUND_AFTER_ROOT_PRESEAL`, `true` |
| `rootApproval` | Nonempty explicit root handoff reference |
| `integrationSealSha256` | Independently supplied final `SEAL.json` digest |
| `authorSourceCommit` | Exact 35da1854 full SHA above |
| `consumerCandidateCommit` | Explicit full composite Git SHA, matching the full consumer receipt; raw 35da1854 is refused |
| `sourceBase`, `acceptedLength` | Exact accepted baseline/length full SHAs above |
| `rootSourceCompositionAccepted` | `true`, supplied by root, not inferred from an author success |
| `consumerReceipt` | `{path, sha256}` for the full existing consumer receipt |
| `admissionReceipt`, `frameworkReviewReceipt` | Root-accepted `{path, sha256}` bindings; opaque schemas are preserved, not guessed |
| `sourceArchive`, `packageArchive` | `{path, sha256}`, exact author artifact hashes above |
| `archiveSourceRoot` | Canonical, regular, complete 273-file source archive materialization |
| `consumerSourceRoot` | Canonical, regular, exact 271-file consumer source view |
| `packageRoot` | Canonical, regular, complete 870-file compiled package |
| `outputParent` | Existing canonical directory outside the workspace and all candidate/component/input scopes |
| `buildProof` | `{classification, receipt}` as described below |

All paths are explicit absolute paths; all hash references require independent
64-hex digests. Candidate and output roots must not overlap. The wrapper does
not follow a conventional `/tmp` ready-file path or auto-load the forthcoming
candidate-admission packet. Root can bind its final files without editing code.
Opaque receipt hashes mean root accepted those artifacts; their bytes alone do
not prove an undocumented PASS field or independent acceptance.

`buildProof.classification` is either `AUTHOR_ARTIFACT_BINDING_ONLY` with
`receipt: null`, or `INDEPENDENT_REPRODUCTION_ROOT_ACCEPTED` with an independently
bound `{path, sha256}` receipt. Both still require the consumer's build receipt.
Exact artifact hashes are not independent serialization/rebuild evidence. No
author 26/19 result or previous 15-control result is inherited as acceptance.

The **existing full consumer receipt** has exactly these ten keys:
`schema`, `sourceBase`, `acceptedLength`, `candidateCommit`, `sourceAdditions`,
`packageAdditions`, `packageDirectories`, `entries`, `allowedBuiltins`,
`buildReceipt`. File descriptors are `{sha256, bytes, mode: 420}`. Directories
are the complete path-to-493 map, including the empty root key. Entries are
`yq: dist/commands/yq/index.js` and `contracts: dist/contracts/index.js`.
There are seven source additions (six TS plus one Markdown) and exactly 24 new
emitted package files. All 846 baseline package files, including README
`87e92b73c7339b104212a9fb11006d339694f65575a7b79debfaa902ef9cf9d1`, remain.
`buildReceipt: {path, sha256}` points to the consumer's real schema containing
`candidateCommit`, `sourceMapSha256`, `packageMapSha256`. The candidateCommit is
the explicitly linked composite identity; map hashes use the consumer's
recursive canonical serialization, not the runtime's tree-array JSON hash.

The data-only `runtimeEntries`/`translateRuntime` helpers bridge that difference
without rewriting source/expected bytes. They emit the exact runtime provenance
and authorization shapes; the runtime candidate label remains the author SHA,
with the composite identity separately retained in provenance. Generated JSON
is exclusive/atomic and enrolled at mode 0644, as the sealed runtime requires.
The consumer allowed-builtins list must fit the existing runtime's fixed five
builtins; an additional necessary builtin is an explicit new-version gap.

## Exports and execution order

- `components.mjs`: `verifyIntegration`, `loadComponents`, raw hash/read helpers.
  It authenticates the consumer verifier before importing guards/type helpers
  and verifies both immutable recipes before/after use.
- `translation.mjs`: `directoryMap`, `runtimeEntries`, `assertFullPackage`, `validateEnvelope`,
  `translateRuntime`, `continuation`. These are harness data helpers, not product
  exports or private query injection.
- `binding.mjs`: `bind` validates exact receipts/maps/artifacts/paths;
  `admitSource` uses the actual consumer `authorizeSources`,
  `assertSourceMaterialization`, `authorizeCandidate` APIs. Git admission runs
  inside a bounded owned infrastructure child, not unbounded in the orchestrator.
- `worker.mjs`: four fixed worker roles: read-only source admission, moved
  original runtime projection, loaded-code binding, and scoped direct types.
  It uses `materializeCandidate`, `assertBound`, `withMaterializedImports`,
  `runDeclarationConsumers` exactly; no private runtime factory is invented.
- `run.mjs`: narrow parent glue over runtime `runJobs`/`authorize`, existing
  fixture materialization/context/assertion helpers, plus `assertWorkerExit`.
  Every nonzero worker fails. Expected compiler rejection is classified only
  inside the existing type worker against the declared fixture diagnostic.

The finite order is source admission (1 child), original compiled runtime (149),
physically moved runtime (149), loaded-code binding (1), direct type worker (1).
The parent admits at most 301 children, with 30-second child deadline, bounded
TERM/KILL/reap and a ten-minute total admission window. Slow hosts or expensive
guards may exhaust that window; remaining jobs stay unrun and aggregate FAIL,
never “unsupported” passes. There is no hard preemption guarantee for parent
filesystem hashing or opaque host JS. No build, native oracle or global typecheck
job is hidden in the plan. TYPE/compiler tool copies use only the sealed pins.

Raw process capture precedes receipt and semantic assertions. Worker command
receipts include byte stdout/stderr, status/rejection, effects/events; TYPE raw
records precede its declared diagnostic checks. Before/after source/package/
component guards include added entries, modes and hashes. All moved trees and
physical identity/staging facts must remain valid before continuation. Missing
movement receipt is an integrity gap and stops subsequent admissions. Timeout
always fails but permits independent continuation only with integrity AND reap;
no error-status waiver exists. No escaped-descendant or sandbox claim is made.

## Coverage and source-proof routing

`core/RECIPE.json` has explicit routes for all 194 original IDs and eight
overlays. The exact original 132 prepared IDs / 149 jobs run in each environment,
not 298 unique cases. Semantic eligibility stays **111 IDs: 94 complete explicit
projections, 17 partial**. Admission/type/source/materialization controls do not
enter this denominator. All **80 original gapped records remain gapped** here.
The direct TYPE additions cover six fixtures over TYP-01/02/03/07, not public
acceptance. MOV-01/03 receive source/byte identity projections only; MOV-03's jq
regressions remain separate and MOV-02 remains public-package pending.

Parser PAR-01..36, query QUE-01..12 and encoder ENC-01..10 routes retain their
original prepared-versus-private distinctions. The recipe explicitly points
CARRY/alias admission to WRK-11/15/16/21/22/26 and applicable ALS cases;
signal/close to LIF-01..10 and WRK-22; readonly input effects to QUE-07 and
FS-01/05/06; output quotas to WRK-17/18/20. Source counterexamples, private invalid
yields, session instrumentation, public Shell lifecycle, provider workflows and
quota injection remain unbound. The different actual reviewer must separately
preseal any additional **source probes** using inspected candidate exports;
no parser/private counter hooks or YqLimits are introduced by this wrapper.

## Preparation validation

`core/check.mjs` runs only the 22 predeclared data/synthetic composition controls
in `core/SYNTHETIC.json`. Its tiny regular-file fixture is below this owned tree;
it checks read-only helper preservation, not YQ behavior. It loads authenticated
harness helpers only—no candidate import, build, compilation, package extraction
or native oracle. Original runtime/consumer captures are read-only. Source and
fixture code are committed before checks; unique results and final seals follow.
