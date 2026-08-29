# HOST-ARRAY-METADATA

## Scope and immutable inputs

This author works only in the new main clone `/Users/kjopek/Workspace/poe-code-safejs-host-array-metadata`, pulled first at `518def9bc43198efcd1da5a927e086fecd33a574` on August 29, 2026. No commits, pushes, branches, README edits, original audit payload reads, real provider calls, or writes to other clones are authorized.

The separate Map final-five manifest is `ab175939e3cbd56dd899e37e99aa010f647b8684a80f83093ee21dff4c0d6b2f`. Its metadata handoff supplies the bounded initial-failure source and observations. That capsule, its five-file delta, and all historical snapshots remain immutable. Map independent review is queued, not publication-approved. Root reports PPR1 independent final-ten READY at `4c38755b5c6f4e789d869cb65fd8cda384c8ddf8c7916b05be4f067803c31fb1`, with the same nine author-file bytes as `cabdebcc481a7371d373000c4990a9bc36c233808f796b692dff76ed1fe9d94b`; the tenth review file is not silently staged without its locator.

The exact frozen PPR2/PPR1/H5/Map source chain is integrated contextually against current main. Main now includes AR and callback-receiver forwarding. Three-way integration preserves that additional receiver change in `interpreter.ts`; H5 `host-bridge.ts` and the final `run.ts` match their frozen prerequisite bytes exactly. Two now-published AR test files receive only the already captured PPR2 jobs-v7 and promise-context-cleanup oracle changes. All current-main preimages, frozen chain postimages, and resulting prerequisite postimages are captured separately under ignored `out/safejs-remediation/host-array-metadata/`.

## Contract and TDD sequence

The guest creates a plain array, adds enumerable own data `metadata = 7`, and returns it through pure host `async callback => callback()`. Native and the host-side observation are `[["0", "metadata"], true, true]`; initial SafeJS returns `[["0"], false, false]`. A checkpoint is not needed. Root confirms this is a supported guest-callback-array defect, not NUM003 or an intentional exotic GenericInput restriction.

1. Reproduce the exact initial failure before modifying production.
2. Add bounded native/source/public-built regressions for own metadata, raw data, shadowed methods, non-index names, aliases, cycles, holes, explicit undefined, and length across both conversion directions.
3. Repair only the native bridge's index-only array copy, reusing prototype-safe own-data construction and descriptor inspection. Preserve existing non-enumerable numeric-entry behavior and hidden named-property exclusions. Do not invoke accessors or shadowed methods, broaden generic property semantics, or weaken function provenance/rejection checks.
4. Exercise completed replay, all prerequisite controls, owned/configured types, lint, formatting, strict patch whitespace, forced builds, and both default full gates with a clean publication projection. Record unchanged legacy diagnostics rather than waiving them.
5. Freeze an independent HOST-ARRAY-METADATA delta, exact post-prerequisite preimages, separate prerequisites, and validation evidence for a distinct validator. No publication authorization is implied.

## Minimal root repair

Only two production paths change. `host-bridge.ts` replaces its numeric-index-only array traversal with own descriptor traversal. It retains length, holes, explicit undefined, existing non-enumerable numeric entries, and the existing per-graph memo table. Enumerable named data passes through the same recursive conversion and capability-path handling as indexed data. Named keys receive the existing string budget charge; numeric index spellings do not acquire a new string charge. Hidden named properties and symbol-key handling retain their prior exclusions. Accessors are rejected without evaluation; no array instance method is invoked.

`values.ts` changes only two existing internal declarations to exports: `defineOwnDataProperty` and `isArrayIndexKey`. Their implementations, all generic conversion paths, G01 measurement, and PPR1 memoization remain byte-for-byte unchanged. The public package entry does not expose these helpers. The bridge reuses their existing safe own-data construction and canonical-index classification instead of adding new copy machinery or weakening function/prototype guards.

The post-prerequisite preimages are `host-bridge.ts` SHA256 `4ee1fad8e50568478ab5cb0bc6923aa77c40a3811ba53c8d14c23c633bbfb1b4` and `values.ts` SHA256 `394b4b1d60d8cf54c100930dde1ae1b058961e86c524e11eee1de56ec2c2a84e`. The Map production file remains exactly `dea680fb83c7210af24b2d5a8574714b2d37451ce63bcfd53a8789eb611bb4c5`. No frozen H5, PPR1, Map, or prior observation is edited.

## Regression and failure receipts

The minimal test fails both on freshly pulled published main and on the exact prerequisite chain before repair: native/host-side metadata is present while the initial guest observation loses it. The final unchanged 15-test fixture has 10 failures and five passes against prerequisite-only source, then passes all 15 after repair. The source/public-built matrix covers the complete 22-field graph, named raw/map/forEach data, non-index names, aliases, cyclic object/array graphs shared through Map/Set, sparse shape, source-function identity/arity, and two completed replay generations for each full-graph route. Callback results exercise outbound conversion before inbound conversion; host callback arguments and host results cover the other entry paths. Supported acyclic direct guest arguments also preserve named aliases and raw data through completed replay. Native function rejection, H5 source provenance, accessor non-invocation, hidden-property behavior, and key budgeting have separate assertions.

Initial matrix diagnostics are retained, including test-fixture corrections rather than production complexity for tests. `deepCopyFromSandbox` intentionally returns null-prototype observation records, so strict native comparisons normalize only those records with `structuredClone`, preserving every asserted field. Fatal budget exhaustion rejects `run`; the corrected oracle checks the same code, budget, current, and limit on that rejection. Explicit owned-test TypeScript checks report zero diagnostics before and after those fixture refinements.

The exploratory cyclic direct guest-argument case also encountered a separate argument-digest defect before host invocation. It is preserved in the initial matrix receipt, not silently treated as a bridge failure or folded into this repair. Final full cyclic/shadowed conversion coverage uses supported callback/result routes; the direct guest-argument control respects the digest's existing explicit acyclic restriction. The final-fixture prerequisite-only RED is rerun after these oracle and scope clarifications, so the RED/GREEN comparison uses identical assertions.

## Separate argument-digest finding

Minimal acyclic source:

```js
const values = [1];
values.map = 0;
return host(values);
```

With pure host `() => 1`, native returns `1`; current SafeJS throws `TypeError: value.map is not a function`, with zero host invocations. `host-call.ts:771` calls the array's own `map` while normalizing the argument digest. That unchanged file is outside this metadata delta. The initial full-graph attempt also contained cycles, which the digest explicitly rejects; the separate minimal case does not contain cycles and isolates ordinary method-shadowing failure. No digest policy or hashing representation is broadened here.

This is a related functional finding requiring root ownership/classification follow-up, not a claim that all host-array operations are fixed. Its exact source, source hash, native/current observations, unchanged production hash, and failure locators are recorded in `out/safejs-remediation/host-array-metadata/separate-findings/host-argument-map-shadow.json`. There are no security probes or original audit reads. Already-dropped metadata in historical captured values is not reconstructed, and no historical capture is rewritten.

## Final validation and publication projection

On August 29, 2026, the default workspace and clean-publication `npm test` gates both pass: 25,873 tests passed and 41 skipped, with 996 files passed and three skipped. Neither gate uses a timeout, selection, or test-configuration override. Both run with TERM unset and forced Turbo execution. Workspace and projection forced builds each complete all 67 tasks with zero cached tasks; the prerequisite-only forced build also passes all 67. The four relevant built runtime artifacts match byte-for-byte between workspace and projection.

The final owned suite passes 15/15 in source and public-built modes; the public-built invocation also passes five unchanged Nash controls. Combined H5, Nash, Map, and HOST coverage passes 42/42 in both source and projection-built modes. Adjacent published controls pass 413/413, and the unfiltered SafeJS gate passes 8,488 with 39 skips. The exact inherited one-line source, not merely a reformatted equivalent, returns native-correct metadata in initial execution and both completed replay generations through source and built APIs. Those minimal routes issue one host call and zero provider calls each; the separate H5 provenance regression uses a finite mock proof provider, never a real provider.

Strict explicit typing passes for the owned test and all 24 introduced roots in workspace and projection. Root, SafeJS, and H5 configured type gates pass; the configured source program expanded with all introduced roots checks 149 roots with zero diagnostics. A separate legacy 42-root expansion remains red with exactly the same 56 diagnostics on prerequisite-only and repaired source, zero new or owned diagnostics. That scope is qualified, not declared green. Its exact command and diagnostic comparison are preserved.

Workspace ESLint passes with only this ignored capture and cache excluded; clean-projection default ESLint, package lint, and workflow lint pass. Owned and composite publication formatting passes. Repository-wide format checking still reports 1,434 warnings, all on files whose bytes match the pulled main Git blobs; none are changed or owned paths. The warnings and equality proof remain captured, without unrelated formatting edits. Final delta, prerequisite, composite strict-whitespace checks and tracked diff checking are recorded separately.

The clean projection is an archive of the recorded main base plus exact prerequisite and HOST publication bytes, with neither Git metadata nor an out directory. Only dependency installation is shared by a node_modules symlink; no capture is imported by publication tests. Projection public-built validation explicitly targets its own built package entry. All 104 resolved composite files match workspace bytes. Production and tests are unchanged after the passing full gates; only this report and prerequisite-status evidence are appended before the final formatting and patch checks.

## H5 prerequisite status refresh

Root now reports standalone H5 final17 independently READY and root-approved, pinned by manifest SHA256 `7f35f5565452ca9985b6f7eca3a05f0c0475cbc0e2e0d5e4afe26c023b226d67` at `/Users/kjopek/Workspace/poe-code-safejs-h5-final-independent/out/safejs-remediation/h5-final-independent/candidate/manifest.json`. Its source is unchanged from the author13 prerequisite. This is a status-only refresh: 14 existing prerequisite postimages equal final17 exactly, and the other two existing paths retain the authorized Map production and newly generated completed-capture oracle overlays. The seventeenth independent report is recorded by manifest metadata, not added to this source delta. No H5, Map, or other frozen capture is rewritten.

Standalone H5 approval does not approve this HOST repair or the combined publication stack. Root reports Nash's staged O05/O13/O14 review on H5 plus Map is ongoing. Map final-five remains separately reviewable at its original immutable hash; HOST needs its own distinct independent validator. The final HOST capsule contains four owned publishables, two exact post-prerequisite production preimages, two absent-file declarations, 102 separately indexed prerequisite paths and their main preimages, and the resolved 104-path publication projection. It does not authorize publication.

## Handoff limits

The separate acyclic HOST-ARGUMENT-ARRAY-MAP-SHADOW finding remains open and is not included in the production patch. Hidden named properties and symbol-key semantics remain outside this enumerable-own-data repair. Already-lost metadata and already-split legacy Map snapshots are not retrospectively repaired. No general getter semantics, arbitrary native-function acceptance, generic input guards, argument-digest cycle policy, or provenance boundaries are broadened. No claim is made that all array-own-property or host-boundary issues are closed.

The final immutable handoff is `out/safejs-remediation/host-array-metadata/manifest.json`. It separates prerequisite and owned deltas, preserves RED and intermediate failure receipts, indexes exact postimages and preimages, and records the separate finding for root assignment. No commits, pushes, branches, README changes, original audit reads, or other-clone writes are performed.
