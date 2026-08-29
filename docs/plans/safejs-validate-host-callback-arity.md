# HOST-CALLBACK-ARITY independent validation

## Decision and scope

Decision: **READY for conditional root intake after ARG; final published all-stack remains HOLD.**

Aquinas, August 29, 2026. Independent delegated validation of Boyle's frozen candidate. The confirmed native-versus-host callback arity mismatch is reproduced on the ordered baseline and corrected by the exact candidate bytes. The earlier classification as an accepted reflection limitation remains withdrawn: no historical acceptance is claimed, and no previously recorded observation is rewritten.

This four-file candidate is for conditional root intake **after ARG**. It is not publication authorization or final published all-stack approval. Release verification, the separate Laplace static boundary review, and later actual-main/all-latest-source QA belong to their assigned owners. Final published all-stack remains **HOLD**.

Only this independent report is newly authored. The production file, 30-case regression file, and author plan remain byte-identical to the frozen author candidate. No additional package test is needed; no source fix, assertion change, generic-input expansion, or timeout override is introduced.

Evidence and final manifest:

`out/safejs-remediation/host-callback-arity-independent`

## Exact inputs and current-main preservation

| Input                                       | Identity                                                           |
| ------------------------------------------- | ------------------------------------------------------------------ |
| Frozen author manifest                      | `6d64bee6827dc59447d684350e8802063b72efe1ea0d170f1aafecc45cd5d2cf` |
| Author base                                 | `89a76018e79d19fe743ef7227e174ba3655e1da5`                         |
| Fresh independent clone, after initial pull | `62253552b11b92e473fd94e1d491e914d5289502`                         |
| Root-approved corrected ARG final5 manifest | `d7ec391880fd9a291b1baa28c085215a7a6875a47760648267aa63853b70ca1a` |
| Corrected ARG review postimage              | `4c28686686472d5bfa162a9ac22a656b9c4c732356ca0e0bfe906dcbd58a259b` |

All 538 author artifacts were verified by exact byte count and SHA-256. Author-base preimages were compared with the pinned author commit, and current-main preimages were captured separately. The baseline and candidate are clean archives of the freshly pulled main with explicit frozen overlays, not reused author working trees. Dependency tools are clone-local copy-on-write copies, not shared writable tool directories in another clone.

Main advanced with PPR1 while this author candidate was frozen. Seven newly present prerequisite files already equal their frozen postimages; the production preimages for `host-bridge.ts` and `values.ts` also changed. The current PPR1 promise memoization additions are retained in the exact frozen prerequisite source.

There is one recorded textual merge conflict, not a zero-conflict claim: `git merge-file -p` on `host-bridge.ts` encounters an empty current side versus an existing H5 `proofFunctions` guard adjacent to PPR1's additions. Keeping that already approved guard yields exactly prerequisite SHA `4425eb05a4cfd552d640943ad99c5e92bddb606938718ea7a83cea969c9b13b1`. The `values.ts` textual merge is clean and equals its frozen prerequisite. No novel merged production bytes were written; the full conflict output and exact-postimage check are retained in `setup/` and `bootstrap.json`.

The author index contains **107 prerequisite paths** and a **109-path composite**. Its ARG final5 approval is metadata, but the corrected ARG independent report is not one of those 107 paths. To retain all five approved ARG publication bytes, both independent projections add that exact already approved report as a separately identified documentation prerequisite. Thus this review uses **108 prerequisite paths** and **110 composite paths before its own report**, without changing any author source/test postimage. This is an explicit scope supplement, not a claim that the author's index already included the report. The supplement and all prerequisites remain outside this four-file publication delta.

All 3,857 tracked current-main paths match either current-main bytes or the explicitly indexed frozen postimages. Current-main non-overlay files, author tests, and all prior fix postimages remain intact. Full identities are retained in `current-main-index.json`, `runtime-preservation.json`, and the final manifest.

## Four publication paths

1. `packages/safejs/src/interp/host-bridge.ts`
   - Historical author-base preimage: 34,551 bytes; `e2c9519a3b4fb3ae4405fdf5aa5cf7fb29335c2236c0de2b995a6e4b5f149c5d`.
   - Pulled-current-main preimage: 34,687 bytes; `963698796bc0f846a319376762dab65918634223f4ceedd8eaf70da2e0543e83`.
   - Required post-prerequisite preimage: 36,229 bytes; `4425eb05a4cfd552d640943ad99c5e92bddb606938718ea7a83cea969c9b13b1`.
   - Validated postimage: 36,338 bytes; `9dadff748af7ec367f3e2fce4ef6eeb0f3f01304cc031b0314abec177fa71276`.
2. `packages/safejs/src/interp/host-callback-arity.test.ts`
   - Absent on both bases and after prerequisites. 15,254 bytes; `c96aa8f2dd131fb458a3b43b64567984648fc27a44ec3b79117f3aadf0a4df42`.
3. `docs/plans/safejs-fix-host-callback-arity.md`
   - Absent on both bases and after prerequisites. 11,693 bytes; `98daa7a6aefdb714b9b3b49fce75c4d02fdc53f1397f18f52b4e5fae009d8ef1`.
4. `docs/plans/safejs-validate-host-callback-arity.md`
   - New independent report, absent on main and after prerequisites. Final byte count and SHA are in the manifest.

There is one production preimage for each named base, one required ordered preimage, and three absent new-file identities. The production patch is intended for the ordered `4425...` preimage, not a blind application to bare current main or the historical author base. The final manifest segregates prerequisites, historical preimages, approval metadata, and publication files.

## Repair and regression coverage

The production change is two lines inside `wrapSandboxClosureForHost`, immediately before the existing identity/cache registration. If the genuine source closure has length metadata, the already-created wrapper receives that value through `Object.defineProperty`. Existing function-length attributes remain non-writable, non-enumerable, configurable; the native descriptor is checked directly. Zero length is preserved because the guard tests `undefined`, not truthiness.

The same wrapper object is registered in the existing callback/identity maps. No execution path, callback ordinal, invocation arguments, source function body, proof conversion, or provenance check is changed. This is a narrow correctness inspection and benign regression validation, not a duplicate of Laplace's separate static boundary review or a general security certification.

The unchanged 30 tests cover the exact original finding; twelve parameter lists through two host routes and six supported source forms; first defaults/rest/destructuring; bound/rebound/over-bound lengths; supported async callbacks; descriptor attributes; aliases and cached wrapper identity; default/callback execution counts; nested returned callbacks; a checkpoint before host invocation; and genuine public replay proof context. Unsupported grammar, raw native-function acceptance, getter execution, and forged proof inputs are not added. Existing generic native-function rejection controls remain unchanged.

## Independent RED/GREEN and broad gates

| Gate                                                       | Independent result                                     |
| ---------------------------------------------------------- | ------------------------------------------------------ |
| Ordered baseline, unchanged source regression file         | 22 failed, 8 passed                                    |
| Ordered baseline, same 30 tests through public built alias | 22 failed, 8 passed                                    |
| Candidate source regression file                           | 30 passed                                              |
| Candidate public built regression file                     | 30 passed                                              |
| Combined H5/HOST/Map/ARG/arity source configuration        | 89 passed                                              |
| Combined public-built-alias configuration                  | 89 passed                                              |
| Explicit adjacent source gate                              | 460 passed across 18 files                             |
| Default unfiltered clean-projection full suite             | 25,920 passed, 41 skipped; 999 passed files, 3 skipped |

Both independent projections were built sequentially before testing/types: **67 successful tasks, zero cached tasks each**. The full command is the unchanged configured `npm test`, with `TURBO_FORCE=true` and TERM unset. It runs `turbo run test:unit --concurrency=1 --`; no test selection, configuration, or test-timeout override is supplied. This review ran one independent full suite, not the author's two separate full suites. The 89/460 selected gates are not full suites.

All 30 owned tests use the public package alias in the built run. In the combined configuration, inherited normalization/journal tests that import internals relatively still execute source; the mixed 89-test run is not claimed to be 89 built-only tests.

## Independent native, host, and fresh-process evidence

Every runtime receipt preserves actual argv, cwd, environment, exit/signal, timestamps, stdout, stderr, and the unmodified JSON dump strings. The inline driver uses only public `run`, `declareHostOperation`, `deepCopyFromSandbox`, `dump`, and `restore` APIs. Source entry is `packages/safejs/src/index.ts`; built entry is `packages/safejs/dist/index.js`. Built child processes do not load `tsx` or private instrumentation. Built module byte identities are recorded separately.

Seven bounded cases were anchored natively before their source/built comparisons. The first six are exact frozen author sources; the seventh is the approved prior ARG sparse graph source, hash-bound through corrected ARG final5. No original audit payload or old QA script was read or executed.

| Case                               | Source SHA-256                                                     | Full native return observation        |
| ---------------------------------- | ------------------------------------------------------------------ | ------------------------------------- |
| Original host-observed arity       | `17a1e1390a0a6a9562fe4efb06a45f72874dd64d5aa67360df85fe69346477b5` | `[1, 0, 1]`; host callback length `1` |
| Bound/rest/async/arrow             | `fc5e31c878a29f6ba42e81be5e74af7afe32ac32c4b040296d9e81f5ae814adb` | `[2, 2, 1, 0, 0, 1, 1]`               |
| Callback aliases/default execution | `e70d49b6b5d39d93a01d91e3320ce938ed04545c93e5d379645cd7ee9cf31177` | Complete record below                 |
| Nested returned callbacks          | `2dd86109b8987f08bbb632732165cdeda54252d0748feebe03277bfca239e161` | `[1, 2, 1, true, 15, 15]`             |
| Before-host checkpoint             | `a863ed3854c1542ba0385e4175588da8c2eccaafdab5217357a05c1162f74e94` | `[2, 1, [3, 4, 1], [2, 5, 1]]`        |
| Genuine proof callback context     | `6f8fcd1f78dc0306789b09bf10c48aac1a46caaf07ff06efd2be8e233d0a10ee` | `7`; host/proof callback length `1`   |
| Sparse/raw/named/alias graph       | `3829a222fc18eab9094c13051a9e100eeb6ad5c17fec993459d2dcb191717b58` | Complete 18-field record below        |

The exact original host observation is now **native 1 / ordered baseline 0 / candidate 1**, in source and real built execution. Its guest return stays `[1, 0, 1]`; that guest equality is not substituted for the separate host observation. The host sees own keys `["0", "map"]` and the full native length descriptor `{ value: 1, writable: false, enumerable: false, configurable: true }`. Source SHA, full host observations, and complete return values remain in `runtime/inputs.json` and individual receipts.

The aliases/default-execution case returns exactly:

```json
{
  "observed": {
    "length": 1,
    "descriptor": { "value": 1, "writable": false, "enumerable": false, "configurable": true },
    "aliases": [true, true, true, true],
    "results": [
      [3, 1, 0, 1],
      [4, 5, 1, 3]
    ]
  },
  "calls": 2,
  "defaults": 1,
  "guest": 1
}
```

The host sees the same callback through both array positions, own `map`, and named metadata, with `raw` referring to the input array itself. Native, baseline, and candidate callback call/result traces agree; only the baseline arity observations differ. Raw captures retain one callback identity with two invocations, rather than manufacturing distinct wrappers to supply lengths.

Function-valued nested returns are compared through explicit target/bound descriptors, lengths, and alias observations before serialization. Generic trace JSON is not treated as a lossless function serializer; those explicit observations and the replay capability identities supply the function checks.

The sparse graph returns exactly:

```json
{
  "length": 6,
  "keys": ["1", "3", "4", "metadata", "raw", "map", "forEach", "01", "-1", "4294967295", "cycle"],
  "leadingHole": true,
  "explicitUndefined": true,
  "middleHole": true,
  "trailingHole": true,
  "value": 7,
  "metadata": true,
  "raw": true,
  "mapShadow": true,
  "forEachShadow": true,
  "leadingZeroName": true,
  "negativeName": true,
  "nonIndexName": true,
  "nestedAlias": true,
  "nestedMetadata": true,
  "nestedMapShadow": true,
  "returnedCycle": true
}
```

Before the pure host adds `cycle`, the complete host observation has the same fields except that key is absent and `returnedCycle` is false. Both baseline and candidate match that native sparse control. No identity difference is normalized away.

### Fresh replay, not historical reconstruction

The independent runtime recipe uses **53 separate process invocations**: seven native anchors, fourteen baseline runs, fourteen candidate initial runs, fourteen fresh completed restores, and four fresh pending restores. All six arity cases diverge in host observation on each baseline entry; both sparse baseline controls pass. All candidate initial host observations and full return observations match native, as do the specified callback traces and alias checks.

There are **32 new successful completed captures and four pending captures**. All fourteen completed restores make zero host, gate, and provider calls. A completed replay can reproduce an already recorded observation without issuing a new host call; this alone is not used to prove reconstructed wrapper arity.

That proof is supplied separately by fresh pending restores:

- Two before-host restores reconstruct source and bound callbacks, then invoke the host once. The newly observing host sees lengths `[2, 1]`, native descriptors, and native callback results. Gate calls are one, provider calls zero.
- Two genuine pending-host proof restores expose callback length `1` through `context.callbacks`. The original host is not reissued; a real `context.replayed[0].result` supplies `7`, converted through `context.toSandboxValue` with the actual request identity and joined disposition. Each has one gate reissue and one provider call. No fabricated callback, proof, or raw native-function input is supplied.

Twelve additional raw graph/lifecycle checks verify callback heap aliases, one cached callback identity/two calls, sparse typed-graph and heap references, the before-host capture containing only a running gate, and matching call IDs/digests/callback histories across genuine proof recovery. Dumps and reference identities are not rewritten. Full results are in `runtime/summary.json` and `runtime/raw-graph-verification.json`.

## Commands and qualified quality results

All validation commands use owned clone-local `npm_config_cache`/`XDG_CACHE_HOME`, TERM unset, playback snapshots with misses treated as errors, telemetry disabled, `SKIP_SYNC_SKILLS=1`, and `HUSKY=0`. No dependency install/sync, commit, push, or home configuration edit is performed by this review. Cache configuration is not a retrospective audit of every author's ambient filesystem write.

Representative commands, from the relevant exact projection with its recorded environment:

```sh
env -u TERM TURBO_FORCE=true npm run build
env -u TERM node_modules/.bin/vitest run packages/safejs/src/interp/host-callback-arity.test.ts
env -u TERM H5_REVIEW_PUBLIC_ENTRY="$PWD/packages/safejs/dist/index.js" H5_REVIEW_EXTRA_TESTS=packages/safejs/src/interp/host-callback-arity.test.ts node_modules/.bin/vitest run --config packages/safejs/test/h5-context-converter-review.vitest.config.ts packages/safejs/src/interp/host-callback-arity.test.ts
env -u TERM TURBO_FORCE=true npm test
env -u TERM node_modules/.bin/tsc --noEmit --target ES2022 --module NodeNext --moduleResolution NodeNext --skipLibCheck --strict packages/safejs/src/interp/host-callback-arity.test.ts
env -u TERM npm run lint:types
env -u TERM node_modules/.bin/tsc --noEmit -p packages/safejs/tsconfig.json
env -u TERM node_modules/.bin/tsc --noEmit -p packages/safejs/test/final-async-proof.tsconfig.json
env -u TERM npm run lint:eslint
env -u TERM npm run lint:packages
env -u TERM npm run lint:workflows
env -u TERM npm run format
```

Configured root, SafeJS source, H5, strict owned test, all 27 introduced roots, and configured source-plus-introduced 152-root checks pass. ESLint, package lint, and workflow lint pass. Explicit publication formatting, eligible composite formatting, and strict added-line whitespace/diff checks are required for the final sealed capture and recorded there.

Two broader scopes remain qualified **RED**, not silently called clean:

- The identical 42-root legacy supplemental type check reports 56 diagnostics on baseline and candidate. Full diagnostic objects, not merely counts, are compared. No owned or new diagnostic is introduced.
- Default root Prettier reports 1,433 warnings on baseline and candidate after the current CI formatting repair. Warning lists and each warning file's current-main bytes are compared; no changed/owned warning is accepted. The count is not the older 1,434 baseline. `.prettierignore` is not claimed as parser-formatted, and the two historical PPR2 JSON ignores remain unchanged. The separate approved ARG report is explicitly formatted too.

## Preserved failures and limits

All six nonzero author command receipts and logs remain captured: genuine RED runs, legacy typing, and default formatting. This review's corresponding RED and qualified failures are retained in full. Assertions, source text, and expected outputs are never weakened to get GREEN.

Reviewer setup/inspection failures are also disclosed: the first verifier expected a `files` field while the new author schema uses `artifacts`; a textual merge was initially assumed conflict-free and halted before projections existed, causing two subsequent dependency-copy commands to fail for missing destinations; and one debug print called `.slice` on an absent optional `heap` serialization. The schema was corrected, the complete actual merge conflict and unchanged-postimage proof were recorded, and raw graph checks address the captures that actually contain graph heaps. None required a source/test/oracle repair or runtime timeout increase.

The exact 38 exclusions and the entire original `security/` prefix remain metadata in `provenance-guard.json`; original payload allowlist is empty. No original or excluded payload reads/hashes/execution, recursive original-audit search, security probes, LLM calls, or guest real IO are part of this task. The package tests use bounded pure mocks and do not create files. Existing full-suite controls are not represented as new security research.

H3's lost initial chronology remains uncertified: 443 reported reads, 73 surviving safe envelopes, and 369 durable recovery records do not restore the lost individual read log. No prior frozen capture, original workspace, README, branch, commit, push, or publisher state is changed. No UI change or screenshot claim is involved.

The previously OPEN arity mismatch is now reproduced and fixed on this exact candidate, not retroactively accepted as a limitation. Root controls its issue/publication closure. Laplace's separate static review and final released/latest-source all-stack gates remain outside this scoped readiness. No exhaustive defect-free, universal reflection, raw native-input, unsupported syntax, or npm-published claim is made.
