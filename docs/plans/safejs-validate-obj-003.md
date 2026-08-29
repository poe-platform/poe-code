# OBJ-003 — independent iterable-input validation

## Scoped readiness, not full original parity

**SCOPED READY for later OBJ-003/OBJ-001 integration; original-workflow closure is NOT ready.** Independent validation on August 29, 2026, approximately 06:40 UTC / 01:40 America/Chicago, confirms native Map and synchronous-generator acceptance, incremental entry consumption, supplied-value aliases, ordering, and abrupt cleanup for the bounded supported cases below.

The unchanged original corpus remains **3 full native matches / 2 full mismatches**, although all five candidate executions complete. Both substantial projection workflows retain four OBJ-001 alias differences each. These are recorded failures, not waived assertions, expected-pass substitutions, or full-green original results. The candidate must be integrated with OBJ-001 and freshly validated before full original parity can be claimed. No such production merge occurs here.

- Frozen workspace: `/Users/kjopek/Workspace/poe-code-safejs-object-iterables`; main HEAD `9ed57df23ff62f4d2eeffd6cf0753cc95624424b`.
- Independent delegated validator, not author Banach; direct work under the root orchestrator. Ancestor/root AGENTS read; no nested package/docs instructions found.
- Original candidate manifest SHA-256: `dbcb3e6afb23276aae78bfb86606408923f4851800f6c631108347d81729781a`.
- Latest original-capture manifest SHA-256: `4bdde885fd956139dbe179ba86be4fb280020d93dc030ca8e53635a7b364d253`.
- The latest freeze governs the three author publishables, including the appended author plan. Production and author tests are unchanged from the first freeze. The original permission clarification and failure history remain intact in both author captures and the latest plan.

## Scope and contract

The local supported surface names Object.fromEntries, Map/Set constructors and entries methods, and synchronous generators: packages/safejs/README.md:135, :151 and :156. The same README explicitly does not expose Symbol or Reflect as guest globals. The existing getSandboxIterator implementation handles branded Map, Set and synchronous generators, plus supported ordinary iterable inputs. This is a supported-method composition validation, not a new universal JavaScript or async-iterable promise.

The production diff only replaces fromEntries' host forwarding with the existing iterator abstraction and an incremental consumer. Each yielded entry is processed before requesting the next one; the new result is a null-prototype object, and allocateProducedSandboxValue budgets without cloning supplied values. No changes to entries, values, getSandboxIterator, copy helpers or other production files are made by the author delta or validator.

The independent test is `packages/safejs/src/interp/globals/object-from-entries-iterables-validation.test.ts` (14 tests). It verifies:

- Map, Map.entries iterators, Set, synchronous generators and array controls preserve supplied nested records/arrays. Source aliases are captured before calling; after-return identities and mutations work in both directions, while outer membership and replacements remain independent.
- A generator reuses and mutates the same pair between yields. Immediate key/value capture, last duplicate selection, surviving earlier keys and ignored generator return values match explicit native anchors; precollecting pairs would fail.
- Integer-key enumeration order, ordinary array-like entries, last-value references, distinct overwritten references and own missing-value membership match native behavior.
- Partially consumed generators resume at their existing position; normal exhaustion executes finally exactly once and never requests cleanup again.
- Invalid entries stop before later yields; plain, throwing and yielding finally blocks have native cleanup/resume traces. Cleanup failures do not replace the original error.
- Bounded low-level host iterator fixtures check exact getter/call order: iterator lookup, cached next lookup, done/value, entry key/value, key coercion, next entry, and exhaustion. Value is not read after done, and return is not looked up after normal exhaustion. This is adapter-level fixture coverage, not a claim that guest Symbol/accessor/coercion syntax is unrestricted.
- Original next/entry-value failures survive a throwing return lookup. Null prototype and supplied-value identity are asserted separately from JSON-compatible data equality.

All guest programs are bounded ordinary functional controls. No LLM, real guest network/filesystem/process capability, security payload, adversarial probe or security research is used. Tests perform no filesystem I/O; existing filesystem-dependent regression tests keep their in-memory abstractions. No test expectations are weakened or skipped.

## Independent RED/GREEN and regression ledger

All evidence paths below are under `out/safejs-remediation/obj-003-validation/`. Records contain exact argv/stdin, statuses, signals, timestamps and complete stdout/stderr. This markdown is the QA procedure; no executable QA file is added.

| Gate                                                          | Independent result                                                      | Evidence                                |
| ------------------------------------------------------------- | ----------------------------------------------------------------------- | --------------------------------------- |
| New-test exact-base RED                                       | 12 failed / 2 passed / 14; exactly one production preimage substitution | `independent-red.json`                  |
| Frozen candidate focused tests                                | 55/55, three files: independent 14 + author 26 + existing Object 15     | `focused-green.json`                    |
| Relevant broader selection                                    | 644/644, eleven files                                                   | `broader.json`                          |
| Prior MC003/MC001/COLL/STR03/TREE regression pairs            | 516/516, ten files                                                      | `published-regressions.json`            |
| Combined repeat after source build                            | 1,160/1,160, twenty-one files, 5.08 seconds                             | `post-build-combined.json`              |
| Configured package source TypeScript                          | PASS                                                                    | `configured-package-types.json`         |
| Both new OBJ-003 test files explicitly included in TypeScript | Zero diagnostics                                                        | `types-including-new-tests.json`        |
| Full configured lint: ESLint, root types, workflow lint       | PASS                                                                    | `full-configured-lint.json`             |
| Scoped formatting and whitespace                              | PASS                                                                    | `scoped-format.json`, `diff-check.json` |
| Forced current-source SafeJS/dependency build                 | 22/22 tasks, zero cached                                                | `scoped-source-build.json`              |

The RED loads the exact git-show current-base object-array.ts bytes in memory, not a guessed mutation. Its SHA-256 is `7addf2003ce301bc2ef24ddac6e7de9737c0a8dae934be64b49631bd45da9d5f`, 10,613 bytes. All other runtime sources are the frozen base; no production file is overwritten or reverted. The array/reference failures include the overlapping fromEntries portion of OBJ-001, not additional iterable issue credit. Two error-precedence controls already pass on base.

All gates use `env -u TERM`. The explicit test-inclusive compiler check is additional to configured source/root checks, which exclude test files. Existing package/dist realpaths are verified inside this clone before building. No configuration or production workaround is used. There are no test/launcher timeouts. No CLI visual change or screenshot certification is claimed.

The author's earlier 15-fail/11-pass RED, 41 focused passes, 630 broader passes, and full-repository 21,818-pass/41-skip history remain author evidence. The full repository suite is **not independently rerun** here; the new independent claims are the finite gates in the table, not a relabeling of author counts. Full lint is independently rerun; full tests are not.

## Unchanged historical originals: failures preserved

Fresh exclusion bootstrap reads only the authorized original inventory-verification metadata before payloads. Exactly 38 excluded archive paths and the entire security directory are blocked. A deny-before-read helper requires an explicit allowlist; actual payload reads are only objects/results.json and the two source paths below. No recursive audit/family search or excluded read/hash/display/execution occurs. The extra inventory.json allowlist entry is unused. Complete access metadata is retained in `audit-boundary.json`.

| Audit-relative original source                 | Bytes | SHA-256                                                            |
| ---------------------------------------------- | ----: | ------------------------------------------------------------------ |
| `objects/lodash-pick-iterable.ajs`             |  2059 | `25b47b2c68933e74160677386425c35404d2b113596722bd284796e7ceab77aa` |
| `objects/reductions/from-entries-iterable.ajs` |   254 | `9ef4f1e11a5c19770c1885e3800bcca0620c873abedfaa11ef3ebb0854b59b6b` |

Five configurations come from original results indices 15, 16, 23, 24 and 25, corroborated by the authorized capture metadata. Source bodies are byte-identical, with no reduction, rewrite or adaptation. Five fresh native children run first and match the original full expected objects. Each later child executes both the exact-base in-memory bundle and current TypeScript on the same unchanged body and caseName.

| Original case              | Exact base                | Candidate completion | Full native parity          |
| -------------------------- | ------------------------- | -------------------- | --------------------------- |
| pick-map-entries           | TypeError, thrown channel | ok:true              | **FAIL: four alias fields** |
| pick-generator-entries     | TypeError, thrown channel | ok:true              | **FAIL: four alias fields** |
| from-entries-map           | TypeError, thrown channel | ok:true              | PASS                        |
| from-entries-generator     | TypeError, thrown channel | ok:true              | PASS                        |
| from-entries-array-control | Completes                 | ok:true              | PASS                        |

All four baseline errors retain the full name/message: TypeError, object is not iterable (cannot read property Symbol(Symbol.iterator)). Candidate original counts are five completions, three full matches and two full mismatches, not five passes. In each failed projection, entriesIdentity, valuesIdentity, rebuiltIdentity and rebuiltMetaIdentity expect true and remain false; every other returned field matches. Full source, expected objects, raw stdout, actual objects and per-field differences are in `original-case-inputs.json`, `original-native.json` and `original-baseline-candidate.json`.

The projections call Object.entries before constructing the Map/generator. On this frozen base, entries and values still deep-copy through budgetSandboxValue. Preserving the supplied entries cannot retroactively restore identity to projected. Static inspection and independent manual-entry identity controls support the OBJ-001 dependency explanation; that explanation does not erase the two failing full-output comparisons. No OBJ-001 production hunk is merged here, and earlier OBJ-001 clones/captures are not written or used as a patched execution environment.

Each standalone child has an eight-second timeout and 128 MiB heap. Current/baseline guest bounds: 20,000 steps, depth 48, string length 16,384, array length 512, data size 500,000 and a two-second deadline after loading. The baseline bundle is entirely in memory with one verified source replacement; no dist or temporary production file is used. Error names/messages and channel distinctions are retained; data equality intentionally does not assert native Object.prototype parity, because SafeJS's existing null prototype is checked separately.

## Frozen candidate and required integration

The independent capture is `out/safejs-remediation/obj-003-validation/candidate/manifest.json`, with its external SHA-256 in `out/safejs-remediation/obj-003-validation/handoff.json`. It records five exact publishables: the three latest author files plus the independent test and this validation plan. `files/` preserves repository paths, `preimages/current-main/` stores the production preimage (the other four paths are absent at base), and `preimages/validation-entry/` stores the three frozen author entry images. Both supplied author manifests are retained as immutable input metadata. Candidate/preimage files, evidence and manifest are made read-only after byte checks.

| Publishable                                                                           | Bytes before independent report capture | SHA-256                                                            |
| ------------------------------------------------------------------------------------- | --------------------------------------: | ------------------------------------------------------------------ |
| `packages/safejs/src/interp/globals/object-array.ts`                                  |                                   11903 | `4a420a0e4f34cf545876860577288f14a45c1a5d57e02c03992b1b016fedbcdd` |
| `packages/safejs/src/interp/globals/object-from-entries-iterables.test.ts`            |                                    6868 | `84b0564efa7a6d5d6f33ffa6a5150d8d0b92f9c1c4884f782fe5ee14228df13f` |
| `docs/plans/safejs-fix-obj-003.md`                                                    |                                   22615 | `997a2a85f6bfbb8de2d8d23e5df90620bcfdee394558f562189fcf7476957387` |
| `packages/safejs/src/interp/globals/object-from-entries-iterables-validation.test.ts` |                                   12489 | `705ebfe457ece12ea7ba14332c0285a1baa76b1ce1848743352659587c146d1a` |
| `docs/plans/safejs-validate-obj-003.md`                                               |                 Final bytes in manifest | Final hash in manifest; no self-reference                          |

The original authorization gap is resolved by the user's explicit functional-corpus permission and is not reopened. Keep the older failure/gap records for chronology. Frozen production, author test and author plan remain unchanged. Only the independent test/report and owned evidence are authored with apply_patch; there are no README/master-plan edits, Git mutations, production edits, commits, pushes or other-clone writes.

Publisher requirements: verify actual current preimages, cleanly three-way integrate with OBJ-001, retain this incremental fromEntries implementation and its reference-preserving result while also preserving OBJ-001's entries/values fixes and all other upstream changes. Never copy this whole production file over a newer tree. Rerun all five unchanged originals and require full expected-object matches, both OBJ regression suites, relevant broader tests, configured types/new-test types/lint and the publisher's full gate. Capture the actual integrated hashes and an independent verdict. This fixed-base report does not certify that future merge, the user-reported publication elsewhere, OBJ-002 sparse behavior, or overall remediation completion.

## Independent merged validation — August 29, 2026

### Scoped verdict

**READY for OBJ-003 publication from the exact frozen base `ecfd838abd37fb061d66dc8721bc3f86067139ad`, subject to the publisher checking current preimages and rerunning its full gate.** This independent direct-worker validation covers the merged OBJ-001/MC003/TREE/HI tree, not a future ARRAY/IP combination. It does not claim that future changes have already been tested. The older 3-full-match/2-alias-failure verdict and authorization chronology above remain intact; this appendix records a new result on a different tree.

Input integration manifest: `out/safejs-remediation/obj-003-integration/manifest.json`, SHA-256 `5abccd5c2c526b2483761dd8693a5341b5977df8bd51bef90f2d39eac24dc7b7`. Independent evidence and the final five-file candidate are under `out/safejs-remediation/obj-003-merged-validation/`. Commands, stdin where used, full stdout/stderr, exit status, original expected objects, and complete returned objects are retained there rather than summarized away.

### Merge and reference semantics

The independent read-only three-way reproduction has exactly **one textual conflict**, at fromEntries. This is a reviewed semantic resolution, not a claim of a clean textual merge. TypeScript AST extraction verifies that every production byte outside fromEntries and the new consumer matches the current base. Object.entries, Object.values, and the complete Number property remain byte-identical to the published base, preserving OBJ-001 and all three MC003 constants. The asynchronous generator consumer is byte-identical to the earlier independently validated consumer (SHA-256 `86e72dd46c63885369744e6a77a55eda76b132b838c803e7a5f65134e8ff0a00`). Thirty-three explicit upstream source/test files, including HI loader/CLI paths and earlier published regressions, match the frozen base exactly.

The synchronous branch uses the existing shared getSandboxIterator adapter as a native Object.fromEntries facade. It does not precollect entries or adapt/copy supplied nested values. Arrays, branded Maps/Sets, and ordinary host synchronous iterables return synchronously; their allocation failures still throw synchronously. Sandbox generators retain their supported Promise-based internal consumer and rejection channel. This is not new support for arbitrary async-only iterables or async generators.

The unchanged independent fourteen-test block verifies incremental processing of a reused pair, key/value access and coercion order against native behavior, duplicate keys and integer ordering, entry aliases before/after conversion and both directions of mutation, eager outer membership, partial consumption, exhaustion, invalid-entry cleanup, and original-error precedence when cleanup also fails. Existing author and OBJ-001 controls preserve the intentional null-prototype result and JSON/structuredClone/host-copy boundaries. No sparse-array or unrelated feature credit is claimed.

Ten appended package tests directly cover the integration-specific timing repair: four synchronous result/alias cases, four synchronous allocation-error cases, and two supported sandbox-generator success/rejection cases. The original fourteen-test describe block remains byte-identical: 12,112 bytes, SHA-256 `3db1b42463440fbc23aa507f1b54469a86de092735ec3fe337e9252ec1adc5ad`. No assertions were weakened, deleted, or permanently skipped.

### Exact-base RED and repaired GREEN

Production was never rewritten for RED. A Vite in-memory substitution loaded the exact git-show current-base source once, checked as 10,728 bytes / SHA-256 `b8a4b6f0adc702ba489e7f513e4a351a858a35a7edb06354df288f5876391e44`.

| Independent gate                                              | Result                                                                            |
| ------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Exact current base, original 55-test selection                | 23 failed, 32 passed; ten newly appended tests deselected by explicit name filter |
| Exact current base, all 65 OBJ-003 controls                   | 29 failed, 36 passed                                                              |
| In-memory async-only regression control, ten new timing tests | 8 failed, 2 passed; original fourteen deselected by explicit name filter          |
| Merged focused OBJ-003 + OBJ-001 + MC003                      | 184 passed: 65 + 40 + 79; seven files                                             |
| Broader selection including MC001/COLL/STR03/TREE and HI      | 1,278 passed; 25 files                                                            |
| Post-build repeat of broader selection                        | 1,278 passed; 25 files                                                            |

The async-only control removes only the synchronous branch from the frozen merged source in memory; its source SHA-256 is `2c1935b2efde6b4308408d00870da1129caa21b8df26e7d52a660ecf8736176f`. It is a regression mutation, not the current-base reproduction. It exposes all eight synchronous-channel regressions while leaving both generator-channel controls green. Rejected promises are observed during failing controls so the checks do not manufacture unhandled rejections. Final independent runs have no unhandled errors.

### Original functional corpus — five complete matches

Before any original payload read, the validator bootstrapped the inventory-verification metadata, established exactly 38 excluded archive paths and blocked the entire security directory. Only these exact nonexcluded files were permitted: `objects/results.json`, `objects/lodash-pick-iterable.ajs`, and `objects/reductions/from-entries-iterable.ajs`. No recursive audit search, excluded payload read/hash/execution, security payload access, guest real I/O, LLM calls, or security research occurred. HI filesystem controls use memfs.

The original sources were replayed unchanged, using all five existing configurations and full returned-object comparisons. Fresh native children match the recorded expectations 5/5. Current source and the exact current-base source were then compared in bounded separate children. Each original run uses 20,000 steps, depth 48, string length 16,384, array length 512, data size 500,000, a two-second interpreter deadline, an eight-second host timeout, and a 128 MiB child heap. Baseline bundling is in memory, not a source edit; candidate evaluation imports current TypeScript, not dist.

| Original configuration             | Exact current base | Merged source     | Node visits |
| ---------------------------------- | ------------------ | ----------------- | ----------- |
| objects:pick-map-entries           | Thrown TypeError   | Full native match | 985         |
| objects:pick-generator-entries     | Thrown TypeError   | Full native match | 993         |
| objects:from-entries-map           | Thrown TypeError   | Full native match | 24          |
| objects:from-entries-generator     | Thrown TypeError   | Full native match | 36          |
| objects:from-entries-array-control | Full native match  | Full native match | 26          |

Source identities: lodash-pick-iterable is 2,059 bytes / SHA-256 `25b47b2c68933e74160677386425c35404d2b113596722bd284796e7ceab77aa`; from-entries-iterable reduction is 254 bytes / SHA-256 `9ef4f1e11a5c19770c1885e3800bcca0620c873abedfaa11ef3ebb0854b59b6b`.

All four prior alias differences in each projection workflow are now native true: entriesIdentity, valuesIdentity, rebuiltIdentity, and rebuiltMetaIdentity. This is **5/5 full parity**, not projection-only acceptance. Complete native/base/candidate outputs are in `original-native.json` and `original-baseline-candidate.json`; all base TypeErrors and the earlier report's 3/2 history remain recorded. Intentional sandbox null prototypes are tested separately rather than misrepresented as host prototype equality.

### Static/build gates and scope limits

- Package configured source types pass: `tsc -p packages/safejs/tsconfig.json --noEmit`.
- Explicit OBJ-003/OBJ-001/MC003 test types pass with all package compiler options retained, six test roots plus 124 source roots, zero diagnostics.
- Adding the two HI test roots initially exposed a validator rootDir scope mistake (their memfs sink fixture resides under package test/). Rechecking the same eight roots with rootDir widened to the package directory passes with zero diagnostics; no source/config edit or type-check weakening was made. Both attempts remain in evidence.
- Configured `npm run lint` passes ESLint, root types, and workflow lint.
- Forced SafeJS dependency build passes all 22 tasks, none cached. All package/dist realpaths were checked inside this clone before building.
- Focused formatting and git diff whitespace checks are final freeze gates recorded alongside the candidate.
- The initial broad-command wrapper failed before spawning tests because node_repl does not expose process. Its evidence is explicitly marked not executed and superseded by the successful real command; it is not counted as a pass.

The separately queued three COLL test-typing errors were not edited and the historical expanded all-test type gate was not claimed green. COLL runtime regression tests are included in the 1,278-pass gate. The integrator's 21,940 full-repository passes / 41 skips remain **author-only historical evidence**, not an independently rerun full-repository gate. This validator independently ran focused and relevant broader gates, not the entire repository. All commands that need terminal-sensitive behavior run with TERM unset. No visual CLI behavior was changed by this patch, and no new screenshot or guest-I/O campaign was added.

### Freeze and publication handoff

The final manifest freezes exactly the same five publishable paths, with updated independent test/report only. Frozen production remains 12,260 bytes / SHA-256 `dbf2fddfb2a5fc7c11ddfabdb30f4a29ec324938a014c8b9e536320f649f1621`. Author test and author plan remain unchanged from the integration input. The first 15,774 bytes of this report preserve the previous report exactly, SHA-256 `022e7a8211cf0f88f80bbc9b9aa20c3a616bade37c02000fbc1e14ecec30f422`. The manifest records final hashes without a report self-hash cycle, exact current-main preimages (production present, four paths absent), and all five validation-entry preimages. Frozen copies are byte-verified and made read-only; old clones and captures remain read-only.

No production edits, README/master-plan edits, Git mutations, branches, commits, pushes, archive writes, or other-clone writes were made by this validator. Changes are confined to the existing independent package test, this appended report, and owned merged-validation evidence. The publisher must check current preimages and the five exact candidate hashes, preserve the reviewed OBJ-001/MC003 merge, and run its full gate. Any later ARRAY/IP or other publisher combination requires fresh preimage verification and full validation on that actual tree; do not overwrite a newer whole production file or reuse this report as certification of an untested combination.
