# Independent final completed Map alias review

Date: August 29, 2026. Role: independent delegated worker, direct execution.

## Disposition

**READY for root review and scoped Map-delta intake**, conditional on the exact
ordered preimages and separately approved prerequisites. This is not permission to
publish, not actual-new-main integration approval, and not final O05/O13/O14
lifecycle/all-stack certification. Root retains publication coordination.

No production repair or new test was authored. The two existing Map test files
already cover the needed regression. The only newly authored publication file is
this report. The original five candidate files, all assertions, and old captures
remain unchanged. The one H5 assertion correction was already root-authorized.

The default full clean-projection command independently passes **24,801 tests,
41 skipped**, with 989 passing files and 3 skipped files. No timeout override,
test filter, private bundle instrumentation, or substituted default test config
was used. This is one independently executed full suite, not two. The author’s
two full runs remain separate evidence.

## Inputs and exact projection

- Frozen Boyle manifest: `ab175939e3cbd56dd899e37e99aa010f647b8684a80f83093ee21dff4c0d6b2f`.
- Author base: `e702430ab3dacfea4a5e4bc7494f7c51953ceba4`.
- Newly cloned and pulled review main: `518def9bc43198efcd1da5a927e086fecd33a574`.
- Workspace: `/Users/kjopek/Workspace/poe-code-safejs-completed-map-final-review`.
- Evidence root: `out/safejs-remediation/completed-map-final-review`.
- Mutable local projections/cache: `out/safejs-remediation/completed-map-final-review-cache`.

All 592 frozen author artifacts were byte/SHA-256 checked. All 99 distinct
prerequisite base identities, including absent identities, were checked against
the recorded author commit. Two local `git archive` projections were constructed
from that commit. Contextual prerequisite patches were applied with `apply_patch`,
then all 99 resulting identities were checked. GREEN applies the exact five-file
Map patch, and all 102 distinct final paths were verified. The baseline retains
the post-H5 production preimage and adds the two unchanged Map test files.

The ordinary review checkout is not overwritten with older production files.
Dependencies were copy-on-write copied into the owned GREEN projection; its
workspace package symlinks resolve locally. Baseline shares only that owned tool
installation. No other clone is used as a writable tool/cache directory.

The complete default run preceded addition of the new H5 review document. That
later addition changes no source, test, configuration, or executable bytes.
The final report/manifest distinguishes the tested 99-path prerequisite set from
that documentation-only supplement. Actual publisher-main composition still
needs fresh default gates.

## Six-file Map publication delta

1. `packages/safejs/src/interp/host-call.ts`
2. `packages/safejs/src/interp/host-call-graph.test.ts`
3. `packages/safejs/src/snapshot/completed-map-alias.test.ts`
4. `docs/plans/safejs-fix-completed-map-value-alias.md`
5. `packages/safejs/test/final-async-proof-conversion.test.ts`
6. `docs/plans/safejs-review-completed-map-alias-final.md`

Only the first path is production. Its change is +3/-3: import and use
`cloneSandboxValue` instead of `deepCopyToSandbox` for fulfilled and rejected
retained host outcomes. No general inbound host-array conversion is changed.

Exact production identities:

- Main preimage, 26,890 bytes: `1f8bec1f24ddd58f343b6a314f8deff05ef4c67dd879ca82ce523186ca84a6cc`.
- Post-H5 ordered preimage, 26,942 bytes: `b8abcf757ac5d4af1a8fb1af96758cd7d703b93c172304edb940d6d413c67d7f`.
- Map postimage, 26,942 bytes: `dea680fb83c7210af24b2d5a8574714b2d37451ce63bcfd53a8789eb611bb4c5`.

The H5 conversion test is absent on main, but **not absent after H5**:

- Ordered preimage, 11,724 bytes: `3e1e08e4bcca9d95f911af69e3bbb61f0c17202025ac7a173325b4a5cbafc73c`.
- Map postimage, 11,723 bytes: `e0fe6c58980f8a63410c3292611252353037c7fe60e262144bd32bc0e6fd726d`.

The other four paths have absent ordered preimages. Exact bytes and hashes of
every postimage and both ordered preimages are in the final delta-only manifest.
Neither prerequisite publication nor metadata follow-on production belongs to
this six-file delta.

## Source review and exact oracle change

`copyOutcome` is used on settlement, snapshot copying, replay restoration, and
outcome retrieval. The former copier preserves existing sandbox Map/Set wrappers
while copying neighboring objects, splitting cross-container identities. The
existing `cloneSandboxValue` shares one `seen` map across objects, arrays, Map
keys/values, and Set values; collection nodes are registered before traversal.
It retains supported closure identities and existing sparse/own-data handling.

The four journal tests independently exercise fulfilled/rejected outcomes in
object-first/collection-first order, detached copies, mutation isolation,
serialized replay, closure capabilities, map/set cycles, sparse presence,
explicit undefined, named `metadata`/`raw`, and an own `map` shadow. The two public
execution tests cover six-field and 25-field native graphs, source default/rest
arity, bound arity, and two completed restores.

The H5 file is byte-identical after exactly this one replacement:

```diff
-    expect(baselineValue).toEqual({ ...expected, map: false });
+    expect(baselineValue).toEqual({ ...expected, map: true });
```

That value comes from `dump(originalBaseline)` generated within the current test,
then parsed/restored publicly. It is not an old already-split fixture. The native
anchor says `map: true`; no other expected property changes. Independently running
the unchanged old H5 tests against the final public source entry produces
**20 passed, 1 failed**, precisely the stale `false` assertion. Final H5/Nash/Map
controls pass **27/27**. This uses the config’s existing public-entry environment
option, not runtime instrumentation.

## Independent native and completed replay evidence

`inputs/graph-programs.json` preserves both unchanged bounded source strings;
`inputs/native-oracles.json` contains their entire six-field/25-field expectations.
Native execution uses only finite pure `host(callback)` and `gate()` functions.
No guest IO, filesystem, network, provider, or LLM capability is supplied.

`portable-graph-command-v2.json` records the exact newly executed inline Node argv
and JSON stdin contract. Each `commands/v2-*.json` stores the complete stdin,
stdout, stderr, exit status, cwd, and timestamps; `graphs/v2-*.json` retains full
values and complete public dump strings with their byte counts and SHA-256.
These are fresh execution recipes, not invented historical argv or a standalone
QA runner file.

The successful independent sequence has **18 distinct process IDs**:

- Two native anchors, checked against every expected field.
- Two post-H5 baseline processes: current result matches native, but both completed
  replay rounds fail native identity observations. Six baseline observations total.
- For each source and each source/built public entry: current execution, an
  in-process completed restore, and two successive fresh-process restores.
  All **16 GREEN observations/captures** match native in full.
- Two GREEN restores of freshly generated pre-Map already-split captures remain
  non-native. Their four damaged collection observations are not normalized away.

Public entries are `packages/safejs/src/index.ts` and `poe-code/safejs`, resolving
to this projection’s `packages/safejs/dist/index.js`. Each new execution calls
host/gate once. Completed restores call neither, request no resume provider, and
retain exact replay records, including capability IDs, across each chain.

`graphs/raw-reference-audit.json` separately checks all 16 GREEN dump graphs:
Map key/value references, shared object identity, closure capabilities, Map/Set
cycles and backlinks, sparse length/presence, explicit undefined, terminal
metadata/raw aliases, and own map shadow. Raw replay reference IDs and complete
replay records are compared directly, without rewriting or deduplicating them.
The terminal array metadata is assigned after the host return; its absence in the
earlier retained host outcome is intentional chronology, not the inbound-array
metadata bug being claimed fixed.

## Independently executed gates

All commands run with TERM unset, clone-local npm/XDG caches, skill sync disabled,
Husky disabled, telemetry disabled, snapshot playback and snapshot-miss error.
Full argv and outputs are retained in `commands/`; no failure log is replaced.

| Gate                                                             | Independent outcome                                        |
| ---------------------------------------------------------------- | ---------------------------------------------------------- |
| Unchanged Map files on post-H5 baseline                          | 6 failed, genuine regression RED                           |
| Same Map files on final candidate                                | 6 passed                                                   |
| H5/Nash/Map focused config                                       | 27 passed                                                  |
| Ten relevant adjacent test files                                 | 165 passed                                                 |
| PPR1/PPR2 current/history controls                               | 83 passed                                                  |
| Forced `npm run build`                                           | 67 tasks, 0 cached, exit 0                                 |
| Default `TURBO_FORCE=true npm test`                              | 24,801 passed, 41 skipped, exit 0                          |
| Configured root and SafeJS types                                 | Both exit 0                                                |
| Three owned test roots, strict supplemental types                | Exit 0                                                     |
| All 23 introduced roots, strict supplemental types               | Exit 0                                                     |
| Configured plus introduced roots, 148 roots                      | Zero diagnostics                                           |
| Default ESLint, package lint, workflow lint                      | All exit 0; package lint 17 rules                          |
| All parser-supported composite files and owned publication files | Format exit 0                                              |
| Expanded legacy 42-root type inventory                           | Exit 2, same 56 diagnostics before/after                   |
| Default root formatting                                          | Exit 1, same 1,434 warnings, zero owned/composite warnings |

The two last rows remain **unresolved RED**, not waived or described as passing.
The entire legacy diagnostic JSON is identical before/after. Every formatter
warning path and its bytes matches the pinned base and author warning list.
`.prettierignore` is the sole composite path without an inferred formatter parser;
it is checked as exact unchanged prerequisite bytes and for patch whitespace,
not silently counted as a formatter pass. The approved PPR2 `.prettierignore`
also excludes exactly `packages/safejs/test/fixtures/ppr2-integration-history/ordered-original-red.json`
and `packages/safejs/test/fixtures/ppr2-integration-history/ordered-v6-generations.json`
to preserve historical bytes. Their hashes are checked, but they are not counted
as formatted. No Map publication path is ignored.

The key default commands are executed from the clean GREEN projection:

```sh
env -u TERM SKIP_SYNC_SKILLS=1 HUSKY=0 TURBO_TELEMETRY_DISABLED=1 \
  POE_SNAPSHOT_MODE=playback POE_SNAPSHOT_MISS=error TURBO_FORCE=true npm run build
env -u TERM SKIP_SYNC_SKILLS=1 HUSKY=0 TURBO_TELEMETRY_DISABLED=1 \
  POE_SNAPSHOT_MODE=playback POE_SNAPSHOT_MISS=error TURBO_FORCE=true npm test
```

Use the recorded clone-local `npm_config_cache` and `XDG_CACHE_HOME` environment
from each receipt as well. Configured package scripts, root Vitest config, Turbo
config, and SafeJS type config were verified unchanged from the base.

## Approved prerequisite status update

Root subsequently supplied and approved H5’s final independent 17-file manifest:
`7f35f5565452ca9985b6f7eca3a05f0c0475cbc0e2e0d5e4afe26c023b226d67`.
All 17 postimages were independently checked. Its original 13 author files plus
three prior review files exactly match the already tested pre-Map prerequisites.
Only `docs/plans/safejs-validate-h5-final-integration.md` is new. It is captured and
formatted separately as a documentation-only prerequisite supplement.

Boyle’s frozen capsule is untouched. Its historical H5 pending/held status is
superseded by the coordinator approval, not rewritten. The final H5 manifest also
records root-approved PPR2 28 and PPR1 Helm 10. The tested Boyle projection contains
the same PPR1 author nine-file layer; Helm’s additional review document is an
upstream publication item, not a Map change or a new runtime test claim here.
Those independently approved publication manifests remain prerequisite authorities.

Final staged lifecycle O05/O13/O14 execution belongs to Nash’s separate assignment;
this review neither duplicates nor approves that work.

## Preserved limitations and failed attempts

1. **Initial host-array metadata loss remains a real bug, assigned separately to
   Boyle.** The benign source is:

   ```js
   const values = await host(() => {
     const values = [1];
     values.metadata = 7;
     return values;
   });
   return [Object.keys(values), Object.hasOwn(values, "metadata"), values.metadata === 7];
   ```

   Native is `[["0", "metadata"], true, true]`; both current source and built
   public API independently return `[["0"], false, false]`. The raw original
   one-line source hash is `3fb9ddd0dd77a7459797af4ab8dc9479159083ef609700b33207c19d417e82bc`.
   `commands/initial-host-array-metadata-unresolved.json` preserves full outputs.
   This is not an intentional restriction, not closed by Map, and not duplicated
   into this production delta.

2. Old already-split snapshots remain split. This patch prevents new retained
   outcome graph damage; it does not reconstruct historical lost identity.
3. The first H5 invocation before dependency build had five collection failures
   because `@poe-code/agent-spawn/configs` was not built. The forced build and
   subsequent unmodified H5 run pass. Both receipts remain.
4. The reviewer’s first ad hoc result comparator incorrectly treated the sandbox
   result record’s null prototype as a semantic field mismatch. The first proposed
   diagnosis also misclassified the initial baseline; both are preserved and
   superseded explicitly. `deepCopyFromSandbox` intentionally preserves null
   prototypes. V2 compares every ordered field and records the prototype separately;
   all guest identity booleans and raw reference checks remain exact. No production
   or test assertion was weakened.
5. Bootstrap metadata parsing initially mishandled `{absent:true}`; a subsequent
   patch conversion rejected an embedded Git header before application. Both were
   recorder/setup errors, not candidate edits. A summary filename collision and
   a formatter invocation including `.prettierignore` were also retained and
   corrected only in separate review evidence.
6. H3 provenance remains qualified: 443 reported initial reads, 73 surviving safe
   envelopes, 369 durable recovery records; the lost initial individual chronology
   is not certified. No original audit payload was read during this review.

No source repairs, original audit reads, new security probes, standalone QA script,
LLM calls, guest real IO, README edits, commits, pushes, or nested agents were used.
Only the authorized initial clone/pulls mutate Git state. No claim is made that
ambient historical author commands could never have written a home cache; this
review explicitly directs its commands to clone-local caches. No CLI visual
behavior changed, so no screenshot validation is claimed.

The immutable evidence capsule includes delta-only publication identities,
ordered/main preimages, separate prerequisite captures, complete fresh outputs,
failed receipts, and the approved H5 status supplement. Root must still check
actual-main preimages, integrate any later changes explicitly, and run the final
publisher gates. Do not infer all-stack readiness from this scoped Map approval.
