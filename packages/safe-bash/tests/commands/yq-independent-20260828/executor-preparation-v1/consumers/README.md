# YQ deferred consumers: root integration interface

Prepared August 28, 2026. This is the consumers component only; do not run the product recipe until a separately authorized immutable candidate exists. Current product/build/compiler/import/pack/native-oracle execution counts are all **zero**.

## Authority and verification

Read `PROTOCOL.md`, then the narrowly scoped `PRETEST-CLARIFICATIONS.md` and `PRETEST-SOURCE-ADMISSION.md` amendments. `PRESEAL.json` and `PRETEST-SEAL.json` preserve the original pretest inputs. `RECIPE-SEAL.json` seals the final exact owned tree, including evidence, byte hashes, modes and directory membership. The only self-excluded entry is the named seal itself; its raw digest must arrive independently from root. Additional files/directories invalidate this recipe seal. Actual artifacts go outside this tree and outside both guarded package copies.

The root MUST authenticate the verifier's own hash from its accepted Git commit, then run:

```text
node tests/commands/yq-independent-20260828/executor-preparation-v1/consumers/verify-recipe.mjs ROOT_ROUTED_SEAL_SHA256
```

Check its zero exit before loading these helper modules; repeat recipe verification after the later job. A claimed digest delivered only inside an untrusted receipt is not sufficient. Before/after snapshots detect added entries as well as changes to original files; they are not append-proof transactions or detection of change-and-restore between observations.

`SELECTED.json` authenticates nine selected immutable inputs, not the whole repository. Its original `publicApi.state` is preserved historical data, not a reopened policy hold: the final CARRY contract/review are accepted. The accepted package report supplies all 846 baseline files (845 common plus exact baseline README); no tarball is executed or unpacked here. Root README identity is SHA-256 `87e92b73c7339b104212a9fb11006d339694f65575a7b79debfaa902ef9cf9d1`, 36273 bytes, mode 0644, source `5137a74ec855a32d8a8860eb66b62eb44d11e290:README.md`.

## Helper exports

`guards.mjs` provides:

| Export | Interface / purpose |
| --- | --- |
| `authorizeSources(receiptPath, independentlyExpectedSha256)` | Read-only immutable Git source admission. Accepts source-only five-key receipt or full candidate receipt; never builds. Returns frozen source authority and `sourceMapSha256`. |
| `assertSourceMaterialization(authority, sourceRoot)` | Checks the complete authorized source/configuration map in a regular copied tree outside the workspace. Root MUST call before and after any future build and emit generated files outside that guarded source tree. |
| `authorizeCandidate(receiptPath, independentlyExpectedSha256, compiledPackageRoot)` | Requires full receipt, trusted build evidence and complete compiled package. Returns enrolled authority; missing candidate is refusal. |
| `materializeCandidate(authority, originalRoot, destination)` | Fresh regular copy, then physical staging-directory rename outside the real workspace. Returns an in-process-only enrolled binding. |
| `assertBound(binding)` | Rechecks original and moved package membership, bytes, modes, physical root identity and vanished staging path. Returns authority. |
| `resolveMaterialized(binding, specifier, parentURL?)` | Authenticates one runtime binding; default root hook is this exact helper module, not arbitrary external code. |
| `withMaterializedImports(binding, ['yq', 'contracts'], async namespaces => ...)` | Exclusive Node import-hook scope covering imports and entire awaited callback. Injects only named namespaces. Returns `{value, imported, proofRole}`. Root preloads all harness dependencies and drains cooperative callback work before settling. |
| `assertPublicAdmission()` | Always throws `PUBLIC_EXPORT_GAP` in this v1; it cannot authorize root/export changes. |
| `expectedPackage(receipt, baselineMap, readmeIdentity)` | Complete baseline plus exactly four emitted paths per new `.ts` source; explicitly receipted module Markdown is uncompiled. |
| `inspectTree`, `assertPackageTree`, `copyAndMoveRegularTree` | Lower-level file/movement guards; raw movement facts cannot create an import capability. |
| `validateReceiptShape`, `assertSourceMap`, `readHashedJson`, `resolveImportPath` | Pure/read-only lower-level guard boundaries available for independent synthetic review. |
| `verifyPreseal`, `verifySelected` | Revalidate selected frozen preparation/Git inputs, without compiling or importing any product. |

Generic utility exports are `requireFact`, `sha256`, `canonical`, `within`, `safePath`, `regularRoot`, `copyRegularTree`, `assertMoveLocations`, `preparationRoot`, and `workspaceRoot`. These are harness APIs, not virtual-bash exports. The low-level resolver is not independently sufficient: actual imports must use the enrolled scope.

Full receipt schema and exact field rules are in `PROTOCOL.md`; the source-only variant has exactly `schema`, `sourceBase`, `acceptedLength`, `candidateCommit`, `sourceAdditions`. Full receipts add exactly `packageAdditions`, `packageDirectories`, `entries`, `allowedBuiltins`, `buildReceipt`. The separately trusted JSON build receipt must bind `candidateCommit`, `sourceMapSha256`, and `packageMapSha256`, where the latter is SHA-256 of `canonical({files, directories})` returned by `expectedPackage`. Build evidence is a host attestation; no independent build provenance is claimed here.

## Type worker

Future direct-declaration CLI, after external recipe authentication:

```text
node tests/commands/yq-independent-20260828/executor-preparation-v1/consumers/type-worker.mjs RECEIPT_PATH RECEIPT_SHA256 COMPILED_PACKAGE_ROOT NEW_MOVED_DESTINATION NEW_EVIDENCE_DIRECTORY
```

`type-worker.mjs` exports `runDeclarationConsumers(binding, newEvidenceDirectory, 'direct')`, `classifyCompilerOutcome(job, rawCompilerResult, fileBindings)`, `assertWorkerExit(childResult)`, `renderFixture(template, explicitTokens)`, and `compilerTreeIdentity(root)`. `runDeclarationConsumers(..., 'public')` refuses the public gap. Root parent code MUST apply `assertWorkerExit` to every worker child; any child nonzero, signal, or spawn error is aggregate failure. The TYPE worker alone interprets the nested compiler's declared negative outcome and writes `ACCEPTED_COMPILE_REJECTION` facts before exiting zero for matched jobs.

The actual worker is deferred, **not tested by compiling fabricated declarations**. It copies pinned available TypeScript 5.9.3, Node type and undici-type trees into new isolated evidence; it uses pinned Node v22.22.2. No install occurs. It compiles six direct jobs: positive TYP-01; two TYP-02; two TYP-03; TYP-07. Five TYP-04 forbidden-export fixtures are public-only and remain unexecuted. Every public TYPE proof remains pending even when direct jobs later pass.

Each compiler invocation writes `<job>.compiler.json` with raw stdout/stderr/status/signal/error/argv before assertions. Matched jobs write `<job>.fact.json`; aggregate `TYPE-RESULTS.json` contains the actual worker exit and no semantic scores. The compiler list of consumed files must consist solely of that generated fixture, authenticated candidate declarations and pinned tool declarations. There is no source fallback or ambient workspace/node_modules acceptance. Strict declaration checking may expose real candidate/tooling errors; those fail, rather than becoming accepted negative outcomes.

## Evidence and limits

`COVERAGE.json` contains the exact MOV-01/02/03 and TYP-01 through TYP-08 records from the immutable 194-ID freeze. TYP-05/06 remain runtime-worker proof; TYP-08 remains private source review; MOV-03 still requires actual jq regressions. Eight overlay roles are not eight added semantic successes. Runtime/provider acceptance, source behavior, public admission, and broad superiority remain unproven.

Synthetic checks are explicit opt-in:

```text
node tests/commands/yq-independent-20260828/executor-preparation-v1/consumers/synthetic-check.mjs
```

They create unique owned fake copies and evidence, never rewrite previous captures, never import their fake `.js`, and never invoke the compiler. Running them again adds evidence and therefore changes final recipe-tree membership; review/route a new seal explicitly rather than treating a changed tree as the old sealed recipe.

The initial 36/36 capture is `evidence/synthetic-haZ8gs/RESULTS.json`. It predates the source-only admission clarification and expanded positive composition/parent-exit assertions; its helper hashes remain visible. Later captures bind their exact helper bytes. These are matched guard controls, not semantic YQ results. The local compiler pins are statically rechecked, not executed.

No hard RSS bound, adversarial filesystem atomicity, sandboxing of trusted JavaScript/Node builtins, prevention of uncooperative activity escaping the callback, or package-export admission is claimed. Import authentication applies to the exclusive awaited callback scope; root must not let candidate work escape that scope. Actual moved product execution and independent framework review are pending root routing. No live YQ source was loaded, built, typechecked, or executed in this preparation.
