# Integration v2 bounded handoff — August 28, 2026

**AUTHOR PREPARATION READY FOR DIFFERENT REVIEW; NO ACTUAL CANDIDATE GO.**

## Exact source and seals

- Final source/preseal commit: `4fafd93a2a414fe9ce1965f77ab45da1d417d10a`.
- Current seal: `SEAL-v4.json`, raw SHA256
  `47c3874f520efee18062d4b2e687159a52039a86d35945a7f5371e85eb00fdff`.
- Initial source `cc39eec693df03fbbdcac3fc822760fd32db81e8`, metadata correction
  `40066dae1150c4de0fda976ce374710ffe068ae3`, author count-control correction
  `a3ab157b65421ddc0e4abf64348b5c8ebe1a46dc` remain historical with earlier seals.
- Final component identities are in `core/COMPONENTS.json`; actual v1-to-v2
  composition differences are in `SOURCE-DELTA-v2.json`. Frozen route data and
  moved worker bytes remain unchanged; runtime-v2 supplies the corrected context.
- Final evidence commit/hash is routed in `/tmp/yq-integration-v2-ready.txt` after
  committing. No self-referential commit is fabricated in this file.

Consumers-v2 source90c4c500 uses recipe69dfaf2a. Runtime-v2 source7add5d2c and
evidence70fa3df6 use recipefc273904/tree6a5ca19f. All11 runtime source-preseal
files matched exact source Git/live bytes before helper loading. Neither author's
synthetic successes are inherited as independent acceptance.

## Usable API and CLI

Let DIR be this absolute directory, NODE be the pinned Node22.22.2 path from
`consumers/SELECTED.json`, and HASH be the current seal hash above.

```text
NODE DIR/core/prepare-runtime.mjs DIR/SEAL-v4.json HASH EXISTING_DISJOINT_EVIDENCE_PARENT
NODE DIR/core/data-check.mjs DIR/SEAL-v4.json HASH
NODE DIR/core/check.mjs DIR/SEAL-v4.json HASH RETURNED_RUNTIME_RECIPE_ROOT
```

The first command invokes the actual authenticated runtime-v2
`materializeRecipe(destination)` in one bounded owned Node child. It returns
recipeRoot,sealPath,sealSha256 and raw evidence location. Host/integrity bootstrap
bytes are proven identical to the v2 recipe, not fallback assertion/context
code. The runtime materializer's other exports are `describeRecipe()` and
`verifyRecipe(recipeRoot)`. The parent cannot be an ancestor/descendant of guarded
source; for future actual work use a fresh external directory. Do not use the
preparation's workspace materialization as an actual root runtimeRecipeRoot.

Only AFTER independent review and explicit root routing:

```text
NODE DIR/core/run.mjs ROOT_RECEIPT_JSON ROOT_RAW_SHA256 DIR/SEAL-v4.json HASH
```

Missing authorization refuses before candidate imports/children/output. Root
schema1 is the exact field list in README; the only necessary materializer
adapter is required absolute `runtimeRecipeRoot`, whose full tree must match
the actual runtime-v2 seal. Both candidate commit fields stay exact35da1854;
no synthetic composite Git identity or mutable HEAD is admitted. Root's exact
raw hash is an independent input, not read from the receipt itself.

`bind(rootPath,rootHash,sealPath,sealHash)` performs pre-import data binding.
`admitSource(bound,explicitSourcePass)` runs only in the bounded owned worker.
`loadComponents(runtimeRecipeRoot)` authenticates the actual materialized recipe
before importing its helpers. Consumer APIs are the actual sealed
authorizeSources/assertSourceMaterialization/authorizeCandidate/materializeCandidate/
assertBound/resolveMaterialized/withMaterializedImports/assertPublicAdmission/
expectedPackage; v2 guards and v2 type-worker share authenticated fixtureRoot.
Type APIs remain runDeclarationConsumers/classifyCompilerOutcome/assertWorkerExit.

## Exact receipts and proof roles

Candidate data packet remains `71a16afd5b430175180fc4741531b75c31b25882`:
FULL-RECEIPT SHAacd5644c6f148bd25d16af8c12a3e01b9319f682b3830ec5f8b19a23e6ae4a56;
RESULT SHAd0bacd61dd564b6ecfec6530aaea28b9b732af2f2677c68739b25b1ff546c2b3;
BOUND-AUTHOR-BUILD SHAef268ccd6e0e9edd1851f3acdc406ac89e939f167beb3124e82c3af106d70a2d.
Their exact repository paths/hashes are enforced. RESULT's historical refusal is
data history, not execution authority; the root-routed review receipt and actual
v2 admission remain required. The consumer receipt has ten fields; source-only
has five. No receipt schema or candidate API is invented.

The273-file source archive and271-file source projection remain separate roots.
The two support files remain in the archive. Source-map SHAe01d63d8e782cba59597da7c970cbd364a35582e4956ab04759064c756df1284
agrees between consumers and packet. Full package870 retains all baseline files
and README. Author archive/package hashes remain e4e6880a... and2942ba1f...
exactly as fully pinned in COMPONENTS; no independent compile has occurred.
Build role is exclusively AUTHOR_ARTIFACT_BINDING_ONLY; independent serialization
does not become build reproduction. A different actual reviewer's bounded build
preseal remains separate. No global typecheck/foreign unclassified.mts is run.

All194 IDs/eight overlays are unchanged. Roles: semantic111,admission34,source23,
lifecycle11,package4,type5,negative6. Prepared runtime is132 IDs/149 jobs in each
environment, not298 unique IDs. Frozen semantic classes remain94 complete
explicit/17partial; these are eligibility labels, not predicted execution passes.
All80 gaps remain (62 absent/18partial). Private/source-only counterexamples,
unbound lifecycle/provider observations and public export controls stay gaps.
Full-record proof needs every obligation; the corrected runtime records unknown,
natural-language and partial obligations as INCOMPLETE then fails. Successful
assertion audits remain BOUND_PROJECTION_ONLY, never full-record semantic passes.

The finite deferred301-child plan is source1/original149/moved149/loaded1/types1.
TYPE uses six scoped direct fixtures over TYP-01/02/03/07; five public fixtures
remain pending. MOV projections do not prove public exports/build/jq regressions.
All sourceProbeRoutes for parser/query/encoder/CARRY/alias/signal-close/readonly/
output quotas remain the frozen194-role references; no new DI/limits/hooks.
PUBLIC_EXPORT_GAP is intentional module-only baseline status, not a product bug.

## Safety and actual checks

Raw worker stdout/stderr/status precede assertions. Nonzero worker, signal or
timeout always fails; independent continuation needs integrity AND known reap.
Uncertainty stops admissions. Scoped compiler diagnostic acceptance never waives
worker nonzero exit. Consumer compiler subcaptures retain its documented text
representation; outer worker raw bytes remain captured. No opaque-host preemption
or escaped-descendant proof is claimed.

Candidate archive/projection/package and materialized runtime recipe trees guard
all added entries, bytes, hashes and modes. Source-preseal files/modes and exact
runtime-v2 root membership are checked before/after children. Its explicitly
non-imported evidence/work namespaces are sealed history/ignored scratch, not
source authority. Neither symlinks nor unlisted files enter executable recipes.
Consumer v2 plus immutable fixture recipe integrity and root receipt references
are retained. Every moved tree remains physically identified and rechecked.

Final author evidence:16/16 data controls,25/25 composition controls, nine syntax
checks, specification checker0 errors/0 warnings. One harness materialization
child exited0 with integrity/reap proof and activeChildren=[]; it imported no
candidate. Unknown obligations retain raw bytes and INCOMPLETE artifacts;
command/cleanup same-object tokens match while equal-looking objects differ.
Prior protocol, author-count, overbroad-scratch and parent-overlap failures remain
in PREPARATION-LOG and their unique raw captures; no failures were rewritten.

Product imports/executions/builds/compiler runs/native product oracles=0. No
semantic YQ passes, final candidate acceptance, independent framework acceptance,
new policy or root/product/history changes are claimed. Await root review/routing.
