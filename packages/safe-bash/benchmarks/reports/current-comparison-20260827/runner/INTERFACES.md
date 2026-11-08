# Read-only file interfaces and preparation receipt contract v2

This is a proposed adapter contract, not an instruction to other owners to change
their files. ROOT can assemble the small manifest from their reviewed handoffs.
This leaf neither writes sibling files nor approves a candidate. Any incompatible
contract revision needs another reviewed runner version, not a permissive bypass.

## Published sibling interfaces read during preparation

All paths below are relative to `benchmarks/reports/current-comparison-20260827/`.
They are read as JSON/text, never imported. Their existence is not candidate
approval, and their integrity seals are not ROOT signatures.

| Owner file | Data interface | Future use |
| --- | --- | --- |
| `cohorts/SEAL.json`, `manifest.json`, `artifact-manifest.json` | Whole-file SHA256/length; historical commit/blob/hash references and preserved attempts | Bind selected version and all dependencies, not a mutable path alone |
| `cohorts/historical-224.json` | Ordered224 rows: `id`, `recipe`, `recipeCanonicalSha256`, `capturedRecipeHash`, `input`, `originalOracle`, `alignedOracle`, `historicalResults` | Same ordered recipes for both separate224 tables |
| `cohorts/historical-breadth.json` | Ordered68 rows: `section`, `recipe`, `oracle`, `review`, `rawEvidence` | 61 primary/7 diagnostics, exact old predicates and failure history |
| `cohorts/profiles.json` | `/original`, `/aligned`, `/breadth`, `/proposed` | Distinct cwd/env/PATH/scratch/budget/provider/byte profiles |
| `cohorts/proposed-holdouts.json` | `/cases`:24 proposed cases, each `nativeExpected: null`; `/profile` | Unapproved holdouts; independent native capture still required |
| `cohorts/overlap.json` | Mechanical match/disclosure maps | No semantic disjointness or additive score inferred |
| `provenance/INPUTS.json` | Historical28 evidence references, native prerequisites, unresolved names, limits, mandatory future inputs | Preserve unknown/unavailable prerequisites; not new candidate authentication |

These are observed interface shapes, not a frozen copy of the siblings. ROOT must
read their final reports/seals and pin their final bytes after review. Do not run
their `prepare.mjs`, `check-hashes.mjs` or `native-versions.mjs` through this runner;
even a version probe is outside the current workload permission.

## Manifest shape

The root-level object has the following required meanings. Extra fields
may hold provenance, but never expand execution authority.

- `schema`: `safe-bash.comparison-preflight.v2`; `mode`: `PREPARATION_ONLY`;
  `executionEnabled: false`, `timingEnabled: false`, `unionScore: null`.
- `scope`: `historical-preparation` or `candidate-preparation`. Historical scope
  permits absent/null candidate, absent/empty reviews and absent/empty engines;
  it requires only `cohortPlan` and `runnerSourceManifest` roles plus the selected
  cohort references. This does not qualify a candidate or waive its later reviews.
- Candidate scope requires `candidate`: exact40-hex `commit`, exact64-hex `sourceTreeSha256`, and
  `state: FUTURE_ROOT_FROZEN`. The referenced freeze document must distinguish
  committed candidate inputs from any accepted dirty/untracked overlay. No claim
  that a clean subset makes this concurrently edited entire repository clean.
- `artifacts`: unique `{id,path,bytes,sha256}` regular files; <=8192 files,
  <=256MiB/file, <=1GiB aggregate. Manifest <=1MiB, ROOT receipt <=16KiB.
  Large reader caps admit the historical113MB Node binary without changing any
  guest execution budget. Bytes are streamed in64KiB chunks. No globs, downloads,
  directory walks, archive extraction or package installation.
- `roles`: candidate scope needs all12 role bindings listed below, not12 files.
  Every referenced ID must be in `artifacts`. Roles may share a document using
  distinct explicit selectors; when shared, all those references need a nonempty
  pointer or rowField. An identical whole-file reference for multiple roles is
  ambiguous packaging, not a substitute for explicit selectors.
- Candidate `reviews.inventoryReview` and `reviews.packedReview`: `{artifact,reviewer,
  decision:"ACCEPT",sourceTreeSha256,packManifestSha256}`. Both subject hashes must
  match the candidate and the referenced pack manifest; reviewers must differ.
  `artifact` may be a selector matching the corresponding role. These are ROOT
  coordination-bound claims, not independent reviewer discovery. Two reviewers
  remain mandatory for candidate preparation even when receipts share a file.
- Candidate `engines`: exactly `virtual-bash` and `just-bash` (baseline `version:"3.4.2"`).
  Each supplies artifact IDs for `entry`, `packageManifest`, `setup`,
  `dispatchInventory`, `resolutionReceipt`, and nonempty `locks` IDs. The receipt
  must distinguish declared resolution from actual future resolution/load events.
- `cohorts`: one to four selected rows with `id`, `recipeCount`, `diagnosticCount`,
  `recipes`, `profile`, `expectations`, `predicate`, `overlapMap`. Exact names:
  `expanded-original-224`, `expanded-aligned-224`, `baseline-only`,
  `new-tool-holdouts`. Expanded rows each224/0; breadth61/7; holdout count is ROOT's
  explicit selected version (currently proposed24), never derived from70-68.
  No all-phase approval is required. New holdouts may be omitted entirely or
  included with `expectations:null`, reported as uncaptured and not measurable.
  Historical224 requires its captured expectations; breadth binds declared-intent
  predicates, not a universal native oracle requirement.

A role or cohort data reference is either an artifact ID or
`{artifact:"id",pointer:"/json/pointer",rowField:"optionalFieldForEveryRow"}`.
An empty pointer selects the whole JSON document. References are hash-bound and
syntactically checked, **not evaluated by this preparation runner**. The future
reader must verify every pointer, ID, row count, ordered recipe hash and byte
payload. Nonexistent pointers or null native expectations cannot produce passes.

For the existing sibling file layout, use these declarations without rewriting
or extracting their bytes:

```json
{
  "recipes": {"artifact":"historical224","pointer":"","rowField":"recipe"},
  "originalProfile": {"artifact":"profiles","pointer":"/original"},
  "alignedProfile": {"artifact":"profiles","pointer":"/aligned"},
  "originalExpectations": {"artifact":"historical224","pointer":"","rowField":"originalOracle"},
  "alignedExpectations": {"artifact":"historical224","pointer":"","rowField":"alignedOracle"}
}
```

When both expanded rows are selected, they must select the same recipes and
predicate, different profiles and different expectations. Either may be prepared
alone without new24/breadth or live-native requirements being invented. This is
a structural check, not proof of unchanged recipe semantics. A receipt hash
mismatch, duplicate/aliased file, stale review, relaxed
predicate or execution/timing flag fails preflight. Missing external files/freeze
produce `WAITING_ROOT`; a candidate freeze is required only in candidate scope.
Neither path produces a success score. The known planned tree/file additions are
not unspecified; frozen inclusion and selected holdout recipes need exact
evidence, never source-name-count inference. No tree/file recipes are added here.

## Exact candidate inputs, not historical-preparation prerequisites

| Role | Required content to be reviewed by ROOT/independent owners |
| --- | --- |
| `candidateFreeze` | Future commit/tree, every source/test/helper byte/mode/path, dirty-vs-committed scope, canonical TS vs captured/native data classification, exact command-name diff and optional plugin inventory |
| `canonicalInventory` | Candidate-specific tracked consumer inventory, authenticated prerequisites, all canonical source/test/helper qualification including actual TS fixtures; no blanket exclusion or old-inventory substitution |
| `inventoryReview` | Independent acceptance tied to candidate/inventory hashes, preserved failed controls and missing prerequisites |
| `packManifest` | Exact candidate package tarball SHA256, byte length and complete membership/content hashes; public exports, Node version/executable hash, build/declaration and packed-consumer evidence; no implicit `src/index.ts` replacement for packed coverage |
| `packedReview` | Different reviewer's acceptance of those exact tar/member/public-consumer/lock bytes after integration; explicit review order and independence |
| `baselineAuthentication` | Pinned3.4.2 official compressed/payload hash/SRI/955-file proof from010411ef plus actual selected installation map and explicit transitive limits; retained package proof is not proof every dependency is authenticated |
| `dependencyClosure` | Root/benchmark/hidden installed lock hashes, exact installed file inventory, actual resolution roots, ESM/CJS/worker/WASM/assets/plugins/native-dependency coverage and gaps; no ambient private SafeJS loading |
| `nativeProfile` | Original/aligned captures and executable hashes, OS/architecture/libc/library/dialect/locale identities, role-bin mapping and version-capture statuses, outside-tree prerequisites and availability; new holdout oracle captures separately approved |
| `cohortPlan` | Sibling seal, ordered recipes and decoded bytes, denominators, controls/diagnostics/call totals, approved holdout name binding, overlap/predicate maps and all historical failed/recovery attempts |
| `executionProfile` | Exact scrubbed host env and actual guest exported env, cwd/PATH/default provenance, constructor/invoke settings, provider/VFS/scratch setup and expected effects, public entry and dispatch plan, network policy and per-case request ledger |
| `budgetProfile` | Each engine's real internal API limits and the common external caps; cancellation/settlement/dispose/natural-close controls and cleanup-failure policy, no adaptive retry budget inflation |
| `runnerSourceManifest` | Hashes for every runner/adapter/supervisor/observer/protocol file and approved execution graph, no import-time effects in data readers, reviewed real lifecycle counterchecks before any measurement |

Every payload needed to resolve these references must be enumerated, not merely
the manifest that claims it. Reading `packManifest` does not unpack or verify its
tar entries here. The static output expressly does not claim semantic inventory,
archive closure, complete installed membership or live module evaluation checks.
No preflight result is itself a candidate freeze or execution authorization.
Missing live-native executables do not automatically veto preparation/replay using
authenticated historical captures; new native capture and new24 measurement need
their own applicable prerequisites and separate authorization.

## ROOT preparation coordination receipt

ROOT supplies an ordinary JSON receipt and its raw SHA256 through the existing
coordination channel. No keys, signatures, signing infrastructure or
`comparisonApproved` field is required. The CLI takes `--manifest`,
`--root-receipt` and `--root-receipt-sha256` only. Required receipt fields:

```json
{
  "schema": "safe-bash.root-preparation-receipt.v1",
  "authority": "ROOT",
  "purpose": "PREPARATION_ONLY",
  "manifestSha256": "ROOT_BOUND_EXACT_RAW_MANIFEST_SHA256",
  "executionAuthorized": false,
  "timingAuthorized": false
}
```

The displayed digest is a placeholder, not a supplied receipt. Its real value
binds the exact raw manifest bytes and thereby all declared artifact hashes and
selectors for the selected preparation scope. Optional coordination identifiers
may be recorded without expanding authority. No receipt or freeze generator is
provided; selfcheck receipts are synthetic and never ROOT authority.

The supplied receipt hash must come from ROOT externally, not from an untrusted
manifest. Hashes bind bytes under this trusted-host coordination convention,
not cryptographic identity. An arbitrary caller's self-authored ROOT string/hash
is not independent ROOT approval. Host JavaScript remains trusted, not sandboxed.

Missing receipt inputs remain `WAITING_ROOT`, with zero engine calls and no score.
A mismatched receipt/hash/manifest or execution/timing-authorizing receipt fails.
An accepted receipt yields only `PREPARED_EXECUTION_DISABLED`: no engine, server,
native tool or timing. Explicit actual future execution approval remains separate,
and the independently reviewed executor is still absent. This revision neither
asks ROOT to authorize comparisons to check preparation nor approves all phases.
