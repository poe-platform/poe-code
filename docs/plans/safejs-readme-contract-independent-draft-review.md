# Independent SafeJS README current-contract draft review

Date: August 30, 2026. Reviewer: Aquinas. Author: Curie.

## Final bounded verdict

**READY for the current-contract draft only.** No blocking factual issue was found in the six corrections or scoped replay guidance at the pinned base. This is not approval of Float32Array, String.prototype.localeCompare, a final feature-complete README, publication, or npm release status. Boyle/Nash implementation facts and the eventual new README candidate require later incremental review; this bounded review is complete now and does not wait for those authors.

The author capsule is immutable draft-v1:

`/Users/kjopek/Workspace/poe-code-safejs-readme-contract-author/out/safejs-readme-contract-author/draft-v1/manifest.json`

SHA-256: `23e65f907572e214f08dc404e3734d0dece359b00cfb105f6a4ac8f429b5113d`.

Fresh owned clone: `/Users/kjopek/Workspace/poe-code-safejs-readme-contract-independent`. An initial authorized pull reaches exactly `e6b70989225781249f2cf395b927186894fad7c2`. No source overlay or Git publication. This includes the published checkpoint contract and the two subsequent auth commits; a tag is not evidence of npm publication. No registry query occurred.

## Exact candidate and preimages

| Path                                        | Base identity                                                                          | Draft identity                                                                         |
| ------------------------------------------- | -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| packages/safejs/README.md                   | 29,885 bytes; SHA-256 856e18584c356edf97099a0002d2273eb5710b97ca85ef5e32326dbe944bc937 | 35,243 bytes; SHA-256 6133aa0d3f6648973b2cf6dac2f61a069d352d1d3f82a1822fe48d19597e9ef0 |
| docs/plans/safejs-readme-contract-update.md | Absent at base and in pulled worktree                                                  | 11,663 bytes; SHA-256 c6398f3875bce33aaf8639a6c16c5526611ab59c3156dd76f41e4fb38f07f443 |

All **9 author manifest members** match their hashes/bytes. All **10 author source/contract pins** match both current files and exact Git blobs. Nine additional implementation pins are captured separately. The author patch passes forward/reverse dry-run and whitespace checks without application or staging. Numstat: README 36 additions/21 deletions, author plan 189 additions. Original root/author sources remain untouched; retained postimages are evidence copies only.

## Six current-contract gaps

| Gap                                                 | Verdict         | Independent basis                                                                                                                                                                     |
| --------------------------------------------------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Synchronous generator checkpoints                   | Pass            | Source/history reconstruction, not opaque/native frame serialization; current bounded [1,2,3,4] contract, not obsolete held proposal.                                                 |
| Mutation versus read-only composition               | Pass            | Array reduce/push and Map forEach/set examples reject reentry; nested read-only array map/reduce succeeds. No blanket collection/nested-callback parity inferred.                     |
| Regex flags versus syntax                           | Pass            | Parser allows g/i/m/s; u/y reject SyntaxError independently from unsupported regex syntax.                                                                                            |
| run rejection, fulfilled diagnostics, guest records | Pass            | Both API channels and application return data remain distinct; tests below measure them rather than infer from error-shaped data.                                                     |
| Function own-property writes versus arity           | Pass, qualified | Actual receiver typeof function, TypeError name/message, ordinary-object control succeeds. Error string coercion is separate; arity does not grant property writes/native reflection. |
| Binary in versus Object.hasOwn                      | Pass            | in reports UNSUPPORTED_NODE; own-only presence check is not inherited membership or a general substitute.                                                                             |

Exact README and source line selectors are in `evidence/six-gap-review.json`. In particular, `interpreter.ts:2898` reports source closures as typeof function; `interpreter.ts:3282` rejects non-indexable assignment receivers; `object-array.ts:46` dispatches own-only hasOwn. The phrase TypeError describes the measured error name, not String(error).

## Bounded source/native verification

One fresh process runs **14 finite pure source snippets with 28 native/source observations**. No installs, builds, unit suite, provider, filesystem capability, network capability or LLM call. Source execution imports `packages/safejs/src/run.ts`, the same run implementation exported from the public index. This is explicitly **source-only**, not a new built/published package gate.

The prior owned tsx loader is read-only, with cache disabled and temporary/home/cache paths confined to this review's own output directory. Exact loader hash, environment, argv/inline program, inputs and complete stdout/stderr are retained in `evidence/bounded-snippet-command.json` and `evidence/bounded-snippet-inputs.json`. Assertions and every output field are retained in `evidence/bounded-snippet-assertions.json`. No standalone QA runner file or unit test file was added.

Measured cases:

- Callable property write: native permits it; SafeJS catch result is receiver function, written false, errorName TypeError, errorMessage Assignment expressions require a sandbox object property.
- Ordinary object property write: receiver object, value 3 on both.
- Guest `{ok:false,error:"application-data"}`: fulfilled SafeJS API `ok:true` with that returnValue unchanged.
- Application `throw new Error("example failure")`: run rejects with Error/name/message, rather than resolving the diagnostic shape.
- Both tested binary-in expression/return sources fulfill with API `ok:false` and `UNSUPPORTED_NODE`. The documentation's broad source-shape qualification is not misreported as a demonstrated channel difference between these two sources.
- Own-property control returns `[true,false,false]` for own undefined, missing, and inherited native toString respectively. No prototype membership equivalence claimed.
- Read-only array composition returns `[[1,3],[2,3]]`. Mutation examples reject `SandboxError`/`reentry` while their finite native controls finish.
- Regex gims returns gims; u/y each reject with exact unsupported-flag SyntaxError messages.

### Preserved error-coercion observation

A caught guest TypeError has typeof object and name/message TypeError/example failure. Native `String(error)` is `TypeError: example failure`; current SafeJS is `[object Object]`. This is an actual observed native difference, not relabeled native parity or an accepted restriction. Acceptance/bug disposition is **not established by this documentation review**, and it is not claimed newly introduced.

This does not contradict the draft's specific TypeError-name statement: the function receiver was independently confirmed as typeof function, and error.name/message identify the refusal. Future examples should not infer the receiver type or error class from String(error), or claim native error coercion. Root can adjudicate error-string parity separately if required. The frozen observation, exact benign source and outputs are `findings/error-coercion-observation.json`; no production repair or author edit is made by this reviewer.

## Scoped replay guidance

The seven linked checkpoint headings exist and match the current contract:

- External capture versus replay mode: default next-yield capture refuses an active injected host call; external replay-mode capture retains the latest yielded replay state, not live native work. The linked contract still refuses same-run host-callback capture.
- Raw write inputs have shallow bindings, not uniformly live or immutable lexical state. Later source changes cannot mutate already serialized bytes, but later dumps or file writes can differ.
- Canonical typed replay/native observations are qualified to tested current cases. Real legacy function-marker alias/name loss is not dismissed as harmless renumbering; no universal whole-dump or legacy-only invariance is asserted. Linked migration guidance binds receipts to the exact artifact.
- Fresh runs use jobs-v7; genuine jobs-v6 histories retain v6 and are not retroactively repaired. Version markers must not be rewritten.
- External proof uses the genuine request/outcome and callback disposition, with the same active context's converter after awaiting the relevant replayed result. It is not a generic native-function importer, cross-invocation adapter admission, or an instruction to invoke a returned function again.
- Already-split Map identity cannot be reconstructed from lost data. Preserve the original and reconcile before authorized reset/migration.
- Old tested plain/nested-object toJSON digest captures may RESET before host/proof work; the tested old named-array control can replay. No universal old-capture or non-invocation guarantee.

These are source/current-contract checks, **not fresh replay execution of all historical cases**. The exact anchor review is `evidence/scoped-replay-review.json`. The stale held proposal is retained as historical context only (SHA-256 `666cd5a51a946ce7af4d7e68cc4c2e6f69ef41c6332aad90a27fc2f93956966a`), not adopted as current truth.

## Existing examples, formatting and patch checks

All **8 existing README fenced blocks are byte-identical**, with independent per-block SHA-256/byte counts. Zero new README examples. Those eight examples were **not executed or recertified**; the 14 reviewer snippets are separate and bounded.

Configured Prettier **3.8.3** content checks pass for both exact author postimages. The base README independently fails that formatting check, confirming the retained author qualification. An initial CLI check against copied files under ignored out could skip them; that receipt is retained and is **not** used as proof. The decisive check calls Prettier.check on file contents with the repository-resolved configuration and logical publication paths, independent of ignore rules.

Forward and reverse author-patch dry runs pass; strict whitespace checks pass. No Git staging/application/commit/push. The new independent report is separately formatted and checked before sealing. No global lint/types/full-suite claim; no source or test additions require a code typecheck.

## Feature and publication boundaries

Neither Float32Array nor localeCompare is newly claimed in the draft README. Their occurrences in the author plan are explicit questions/pending facts, not support promises. The optional-fs Buffer/Uint8Array text is unchanged; later feature facts must determine whether it needs revision. No racing Boyle/Nash implementation clone was read. No new constructor, method, coercion, locale/ICU, checkpoint, public-type or npm-release claim is approved now.

Later review must intake frozen feature manifests/source pins, validate exact supported forms and error channels, inspect any new examples and stable expected results, and repeat incremental preimage/content-format/link checks. This review imposes no new feature requirements and does not expand either author's implementation scope.

Only this new report is the independent publication candidate: `docs/plans/safejs-readme-contract-independent-draft-review.md`. The exact two author paths are reviewed and captured separately, not applied or rewritten by this worker. Root remains publication authority. The final independent findings manifest is under `out/safejs-readme-contract-independent/draft-v1/manifest.json`; immutable old capsules remain unchanged.

## Provenance and exclusions

Ancestor/root AGENTS read; reviewer differs from author and executes delegated work directly. Exact 38 excluded paths plus the whole security directory are denied; original-archive payload allowlist is empty. **Zero original audit payload reads**, security probes, source fixes, SKILL edits, live skill sync, actual-home edits, master-ledger edits, other-clone writes or Git publication. Approved retained copies only. Prior H3 incomplete read chronology is not reconstructed or recertified.

The README draft and this report remain deliberately narrower than universal ECMAScript/native parity, exhaustive current replay correctness, or future feature readiness. Error coercion is explicitly measured rather than waived; future Float32Array/localeCompare approval remains pending a new frozen candidate.
