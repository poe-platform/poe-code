# CTX001 independent ordered review

Date: August 29, 2026. Role: independent direct worker; root coordinates publication.

## Scoped decision

**SCOPED READY on `32caeaddbac72bccea1cb3fd0a07fb293a1bee71` plus the exact LANG and AW prerequisites, followed by the frozen CTX delta. Publication is not authorized by this review.** No runtime regression or new underlying type diagnostic was found in this ordered combination. Root approval, actual publisher preimage checks, and fresh full gates on any later combined tree remain required.

The separate shadowed-map serialization defect is a **real open bug**, not intentional behavior and not closed by CTX or LANG. Root has assigned Boyle to check the queued OBJ2 candidate and repair it if necessary. This review does not duplicate that investigation or repair. Membership in the original 47 findings remains unconfirmed; the follow-up is separately tracked. No AR/PPR/OBJ002/CBI composite is staged or certified here.

## Frozen inputs and ordering

- Workspace: `/Users/kjopek/Workspace/poe-code-safejs-callback-this-integrated`.
- Main base: `32caeaddbac72bccea1cb3fd0a07fb293a1bee71`.
- Author input: `out/safejs-remediation/ctx-001-integration/candidate/hash-manifest.json`, SHA-256 `e5eaa6498dc87ef218a162843b6c09bd762ade92172077aae54d1941e5030610`.
- Separate LANG prerequisite manifest hash: `aa0da0315f7e77b30e527dbfa6aaed065fb5c687d28b975c3a0ae817531fa68e`.
- Separate AW prerequisite manifest hash: `5a10256673e8ef553738223efd0caca1fd2325e1980da6f8d8090a9a2a22e2ae`.
- Independent evidence: `out/safejs-remediation/ctx-001-ordered-validation/`.

All 86 listed integration artifacts were independently hash/byte verified, with the original-corpus guard applied before captured payload reads. The nine CTX publishables and all separately staged prerequisite files matched their frozen captures at entry. In-memory forward and reverse application of the author delta reconstructed all nine files exactly. The three prerequisite production preimages match pinned main; their postimages match the ordered CTX preimages where the files overlap. The six prerequisite tests remain separate from the CTX delta.

A patch that applies textually to bare main is insufficient. These five exact ordered production preimages must be enforced:

| CTX production path                                  | Ordered preimage bytes | Ordered preimage SHA-256                                           | Candidate bytes | Candidate SHA-256                                                  |
| ---------------------------------------------------- | ---------------------- | ------------------------------------------------------------------ | --------------- | ------------------------------------------------------------------ |
| `packages/safejs/src/interp/globals/object-array.ts` | 12260                  | `dbf2fddfb2a5fc7c11ddfabdb30f4a29ec324938a014c8b9e536320f649f1621` | 12297           | `b5d296fb4f0267cae87b13724f3e2894f07cebc50616f3686720b4303ebd190c` |
| `packages/safejs/src/interp/interpreter.ts`          | 99431                  | `f3b7c19f4ef98ec757e40d8a8c8a6d372329f80c5a12f8617b41ea198b01b132` | 99563           | `d3e317129835f99d75e6607f97fa49805504de3c6c003fe800c3684416bb8d8f` |
| `packages/safejs/src/interp/methods/array.ts`        | 23188                  | `00ed651f1d5a526b270210a25ef483960bb791066a11d4319aba0e168543efee` | 24066           | `a0f82d479c4ad448a04f0650c43b8ea07d1be7a5665615f0086e6d4ad3b3115d` |
| `packages/safejs/src/interp/methods/map.ts`          | 3211                   | `6bf319b155d83fc102c28b0443348832f16147c343fbddc7f0532f0c59c3aa38` | 3250            | `c256f2b1a349a0ac054aeba9376580750686bdda7d775c3e88b19454fd5b1765` |
| `packages/safejs/src/interp/methods/set.ts`          | 3004                   | `2b3d21c1f6108c290e78d4ad9c6014cee1ed764ef66c156cd7a8fb725aa6f278` | 3043            | `b6c533dedd720dc223367a6bb5b74cf6b42b6bb56818ae9db14a347cd6218c7d` |

## Semantic review

The source changes forward a receiver, not a new argument list or a copied callback. Ten Array callback methods use argument two; Map/Set forEach use argument two; Array.from uses argument three. The interpreter passes that value through its existing invocation context. Strict ordinary functions receive the supplied value unchanged, including null and primitive values; omitted receivers remain undefined. Existing source invocation owns arrow lexical this, bound this, bound arguments, and source arity. No callback or receiver object is globally rebound between calls.

The independent AST and byte-preservation checks establish:

- In object-array.ts, only `arrayFromSandboxValues` changes. The complete shared global constructor, Object.entries/values aliases, Object.fromEntries dispatch and generator consumer, and Number constants remain byte-identical to the ordered preimage. Array.from's existing collection/allocation behavior is not newly certified as general iterator conformance.
- In interpreter.ts, only `createArrayMethodOptions`, `createMapMethodOptions`, and `createSetMethodOptions` change. Invocation, source exception handling, lexical/bound receiver behavior, and AW catch logic are unchanged.
- In array.ts, only receiver-bearing callback plumbing changes. The readonly reentrancy guard, own-property lookup, reducer bodies, comparator bodies, and their dispatch cases are byte-identical. Reduce/reduceRight argument two remains initialValue; extra comparator/reducer arguments do not become thisArg.
- Map/Set retain their existing traversal and try/finally guard-release behavior; only the callback receiver is forwarded. No new mutation-during-traversal contract is claimed.
- Nine explicitly pinned published NUM/nonoverlapping source paths remain byte-identical to main. Frozen PPR metadata confirms no direct CTX production overlap; that metadata check is not PPR runtime or composite validation.

The 141 author tests and 37 inherited independent tests remain byte-identical, as do all ten integration tests. They cover receiver identity and mutation, omitted/null/primitive receivers, callback argument order and arity, arrows and bound functions, successive different receivers, reduce initialValue, comparators, completed replay, and finite active-await checkpoints. The ten cross-fix tests include aliased readonly nested traversal, distinct inner/outer receivers, published OBJ003 iterable use and OBJ001 entry aliases, NUM arity, ordinary source-thrown receiver identity under AW, and guard release after exceptions. All 251 LANG and 195 AW prerequisite tests pass. No new package test or assertion modification was necessary; no tests were weakened or newly skipped.

## Independent RED and GREEN

The genuine RED substitutes only the five hash-checked ordered production preimages into Vite's module loader, once each, without changing disk source. It independently reproduces **120 failures / 514 passes / five captured rejection errors** in the same 634-test selection. All 446 prerequisite tests pass in that RED; the failures belong to the CTX oracle and cross-fix cases. Those rejection errors remain in the historical RED output and are not attributed to GREEN.

| Independent gate                          | Result                                                                                                       |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Exact ordered prerequisite RED            | 120 failed, 514 passed, five errors                                                                          |
| Frozen focused GREEN                      | 634 passed across nine files: CTX 141 + 37 + 10; LANG 251; AW 195                                            |
| Full root unit suite                      | 24,278 passed, 41 skipped; 966 files passed, three skipped; exit 0                                           |
| Post-build full SafeJS suite              | 6,893 passed, 39 skipped; 176 files passed, one skipped; exit 0                                              |
| Root build                                | 67 successful workspace tasks, 67 cached; root schemas, TypeScript, wrappers and bundle execute successfully |
| Forced SafeJS dependency build            | 22 successful tasks, zero cached                                                                             |
| Configured root and package source types  | Pass                                                                                                         |
| All nine owned CTX/LANG/AW new test files | Pass without compiler-option relaxation                                                                      |
| Configured ESLint and workflow lint       | Pass; only remediation evidence excluded from ESLint                                                         |
| Final scoped format and diff whitespace   | Pass, with complete command outputs in evidence                                                              |

The root suite is independently executed here, not merely quoted from the author. It uses `env -u TERM SKIP_SYNC_SKILLS=1 POE_SNAPSHOT_MODE=playback POE_SNAPSHOT_MISS=error npm run test:unit`. Existing test setup rejects unmocked fetch and LLM calls; snapshot playback misses are errors. No live provider run or guest real-I/O scenario was introduced. No visual CLI behavior changes, so no new visual campaign was added. Existing skips remain visible; no new skip is used to obtain a pass.

### Legacy diagnostic comparison

The full root tsconfig, which includes legacy test files excluded by configured source gates, has **2,748 diagnostics before and 2,748 after** the CTX change. All diagnostic locations and codes match; no new underlying diagnostic is introduced. This full legacy project is not claimed type-clean.

The initial exact-message comparison exits 1 because six existing TS2345 messages in `interp/running-state.test.ts` render the new optional `thisValue?: SandboxValue` in the expected callback type. The existing cause remains an incompatible `readonly never[]` callback parameter. The six locations are lines 104, 114, 117, 131, 134, and 137; their codes and all other message text are unchanged. The other 2,742 messages are exactly unchanged. Raw diagnostics, the initial strict comparison, and the explicit location/code/message classification are retained. No diagnostic is suppressed, no source is edited, and no legacy type repair is bundled. The explicit nine-new-test-file gate has zero diagnostics independently.

## Eighteen unchanged original comparisons

Before payload access, the validator read only inventory-verification bootstrap metadata, established the exact 38 excluded archive paths, and blocked the entire security directory. Original payload reads use the explicit hash-verified captures listed by the frozen integration bootstrap: callback-context-controls/results.json, its three source files, and callback-context-review/results.json. No recursive audit/family search, excluded read/hash/execution, security payload access, or original archive write occurred.

| Unchanged source                   | Bytes | SHA-256                                                            | Fresh native   | Current source | Completed replay |
| ---------------------------------- | ----- | ------------------------------------------------------------------ | -------------- | -------------- | ---------------- |
| `sources/01-map-thisarg.ajs`       | 354   | `e57f06330ebbd420b6b7753dd41552d95f68ea6d7f9d17d21939135007c766bb` | 2 full matches | 2 full matches | 2 full matches   |
| `sources/02-foreach-thisarg.ajs`   | 362   | `64c93b5ffa1df5705da776f23dfabb5b90e0b1ec31d78f50cad607f834f8585b` | 2 full matches | 2 full matches | 2 full matches   |
| `sources/03-map-explicit-call.ajs` | 439   | `af0e88306b769376818b5a7ca40aa4cdb892df57254290520a53fe048a84de51` | 2 full matches | 2 full matches | 2 full matches   |

Native execution imports the exact original ESM bytes from an in-memory data URL. Current evaluation imports current TypeScript, not dist, and uses the original default-entry invocation. Completed snapshots are serialized and parsed before replay. Full output records, context/array identity flags, and explicit positive-zero checks match the independently retained manual expectations in all 18 comparisons. Prototype normalization for returned sandbox records does not drop fields or relax numeric equality. These are the original three synthetic API controls, not newly claimed OSS algorithms or substantial workflows.

The original current-source children also evaluate the exact ordered prerequisite source bundled only in memory: the two supplied-thisArg sources fail twice each with thrown TypeError; the explicit-call source and its completed replay match twice each. The sources are not rewritten for either engine. Full native/base/current/replay returns, errors, source hashes, command stdin/stdout/stderr and statuses are in `original-native-summary.json`, `original-source-replay-summary.json`, and the individual records under the independent evidence directory.

Bounds: 20,000 steps, call depth 32, strings 4,096, arrays 128, data 250,000, and a 1.5-second per-run interpreter deadline. Native children use 128 MiB and six-second host timeouts; source/baseline/replay children use 192 MiB and ten-second host timeouts including bundling. No guest capability bindings or real I/O are supplied.

## Open serialization qualification

Before root's follow-up assignment, this validator confirmed only the four existing LANG own-map-shadow controls, without expanding the corpus: all native/current comparisons match, while completed serialization throws `TypeError: value.map is not a function` on both the ordered prerequisite and CTX states. Those inherited tests remain native/current-only; the limitation is not converted into a replay pass. All ten CTX integration tests do include replay.

Root subsequently confirmed the defect as real and assigned Boyle. The user-provided follow-up manifest is `/Users/kjopek/Workspace/poe-code-safejs-nested-array-reads-integrated/out/safejs-remediation/shadowed-map-serialization-handoff/manifest.json`, SHA-256 `b0180aa4b983af140d713e51a17360aec6dc501f9928cb9fd1be9832b9dcffcf`. This is recorded as root-provided coordination metadata, not a new independently inspected payload. No further duplicate investigation or repair follows that assignment. Original-47 membership is unconfirmed. CTX readiness is scoped to receiver forwarding and preservation of this ordered tree, not closure of this bug or overall remediation.

## Delta-only publication handoff

The final candidate contains **12 CTX-related paths: five unchanged production postimages, three unchanged tests, and four documents**. The author integration's nine files are preserved exactly. The original author plan and original independent review are restored byte-for-byte from the prior frozen CTX captures, and this ordered review is added. This retains all CTX review history rather than replacing it with the latest verdict:

- `docs/plans/safejs-fix-ctx-001.md`: 8,952 bytes, SHA-256 `d64e99cc158448e4c260ce161daec33f7f6c57da941a4063f800b6a85e7a76ab`.
- `docs/plans/safejs-validate-ctx-001.md`: 14,089 bytes, SHA-256 `bf3d0459af79880c00dffb78d2d605d26110b51be283065edd933ed4e9031b9c`.
- `docs/plans/safejs-integrate-ctx-001.md`: exact frozen integration-author plan.
- `docs/plans/safejs-validate-ctx-001-ordered.md`: this independent review; final bytes/hash in the manifest, avoiding a self-hash cycle.

The manifest records each exact postimage, each of the five ordered preimages, pinned-main preimages separately, and the absence of all seven new paths. The CTX-only patch receives exact in-memory forward/reverse verification over all twelve paths. LANG/AW production, tests, plans and staging patches are not silently added to the CTX publishable delta; their prerequisite identities and separate evidence remain explicit. Candidate copies, manifest, reports and evidence are hash-checked and protected read-only; old clones and frozen captures remain untouched.

No production/test edits, README edits, Git mutations, home writes, branches, commits or pushes are performed by the validator. Only the three review-document additions and owned evidence are authored with apply_patch. Existing generated terminal-pilot assets remain outside this candidate. The publisher must obtain root approval, check all actual ordered preimages and candidate hashes, preserve published OBJ003/NUM and the exact prerequisites, and run fresh full gates after any future AR/PPR/OBJ002/CBI or other combination. Never replace a newer whole source file solely because this earlier candidate was scoped-ready.
