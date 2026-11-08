# Final composition readiness — SOURCE only

Date: August 29, 2026. Campaign endpoint: **18:02:36 UTC today**. This bounded
readiness invocation began 16:36:32 UTC; its deadline is 16:51:32 UTC. It does not
claim the 72-hour campaign is finished or that the combined product is proven.

## Practical conclusion

**No TypeScript/package integration patch is indicated for the listed features.**
The actual tracked working source already contains their coherent union. Do not
overlay whole historical runtime/parser/package/index files onto it. Freeze a
clean selected-input fixture, not the complete working tree or arbitrary HEAD.

The exact actual-working union contains **323 paths**, all present, from 309
PUBLIC baseline inputs plus 12 private ERE inputs and two runtime helper inputs.
The scoped tracked inventory has 363 paths and no index/working-byte differences
at inspection; 40 tracked paths are outside the requested union. Full paths,
sizes, SHA256, blob identities, working presence and accepted-version origins are
in `FINAL-COMPOSITION.json`. Its canonical row-array SHA256 is:

`0099757441f2486b451eb44d27349f9eb862f3c275a57815bd692ac2743cd63e`

Whole `FINAL-COMPOSITION.json` SHA256:
`2253d8b49e5d5122416fb736a4dfd876d50ffdbfcd19709dbbb30e4fd4113f83`.

## Feature preservation and collisions

- PUBLIC309 comes from
  `tests/integration/agent-bash-coherent-author-20260829/v2/SOURCE.json`, SHA256
  `ef0b79dbd30cebec3f8b939a98928b9441947ff4be724e5031b2ee03925f26ae`, declared
  derived identity `3adc676a0ab638c9788ef007e465931d65d2c6fe`. All constituent
  selected blobs were authenticated; it is not assumed to be a stored Git object.
  Current package.json, root index, public Node module and other baseline inputs
  are exact except README and the four intentionally changed shell CORE files.
- ERE CORE conditional.ts/shell.ts exactly match e013f817. Its parser/runtime
  added blocks and exact surrounding contexts remain in the current files.
  All five selected engine files match 72187e5, not merely that commit's one-file
  incremental diff. All seven transport files match their selected accepted
  versions, including exact owner.ts/root.ts from 4abbdeec. The old transport-root
  context is intentionally superseded by that accepted repair, not lost.
- Current parser.ts exactly matches function-keyword 52b6711e while retaining
  CORE parser changes. Restoring the older CORE parser wholesale would lose the
  function-keyword integration.
- arithmetic-parameters.ts exactly matches ffac894a, and all three arithmetic
  runtime-delta blocks plus exact contexts remain. Current runtime.ts exactly
  matches PIPESTATUS 73d9e74d and contains both the earlier CORE and arithmetic
  deltas. Do not overwrite it with either earlier runtime snapshot.
- pipestatus.ts exactly matches correction 43050e86; the original whole-file
  73d9e74d helper would lose that correction. Both new helpers are included in the
  323-path union. `HUNK-REVIEW.json` retains the exact SOURCE comparisons.
- User-supplied acceptance qualifications remain: arithmetic 69/69 actual across
  three layouts author-passed; PIPESTATUS 36 PURE accepted, 78 actual pending;
  repaired ERE producer DATA independently accepted at 5c2ef079. These observations
  are not replayed here or transferred to a new unified package. The accepted
  1002-member ERE archive alone omits the public-Node/new-runtime union and is not
  the final combined package.

## Short blocker/selection list

1. **Manifest identity qualification, not missing product code.** The first
   resolver invocation rejected an assumed tree-hash equivalence. Its independently
   reconstructed ordering yields baseline c5e49e70c295d7e354eba53d1a91141ad701e3f6,
   not the manifest's declared 3adc676a identity. That failure remains in
   `resolution.stderr`. The original canonicalization recipe has not been
   reconciled here. Do not silently replace the accepted identity, claim a Git
   object, or certify reviewer tree da3d47fea4e75e5a0766e823454f434324ad416a as
   an accepted tree. Bind the explicit verified input-row manifest and use the
   original producer's declared ordering when sealing the next build.
2. **README selection.** README.md is the sole union path without an exact
   selected accepted-source origin in this audit. Its full delta is retained in
   `PUBLIC309-DIFFERENCES.json`. Either review that documentation delta or select
   the already-authenticated PUBLIC309 README in the clean fixture (blob
   d4618a2170f53ed8f6f20fe1a320ab32e84dab23). That is a fixture-selection decision,
   not permission to overwrite the working README. Regenerate the exact manifest
   if selecting different bytes.
3. **Build/finite smoke still unrun.** Forty tracked extras comprise seven build
   scripts and 33 source/documentation assets, including xan, yq and query-core.
   They are inventoried, not deleted or silently merged into the supplied accepted
   feature union. The current root index/package remain the public baseline and
   do not establish acceptance of those extras. A repository-root wildcard build
   would include more source than this frozen union; use the clean fixture.

No new harness campaign is proposed. Minimum implementation patch: **zero source
or package files**. Retain the current parser/runtime/transport repairs and use
the exact selected paths; settle only the explicit source-manifest/docs selection.

## Frozen build/package procedure — future authority only

1. Admit the final selected manifest and every regular input by size/hash before
   writing a fresh clean source directory. Carry the 323 paths only, adjusted
   explicitly if ROOT selects the accepted README. No live HEAD overlay, untracked
   recursion, private poe-code input, or old compiled output.
2. Reuse the existing pinned Node/TypeScript/npm closure and distinct empty npm
   configs from the corrected CORE producer. The 115 regular declaration files
   for @types/node 22.20.1 and declared type-only undici-types 6.21.0 were freshly
   reauthenticated at both original paths and isolated copies. Their exact
   manifest is `tests/compatibility/bash-ere-core-transport-rebind-20260829/author-v3/TYPE-TOOLS.json`.
   No install or new dependency is needed; runtime dependencies remain empty.
3. Freeze the exact manifest, tool/config bindings, environment, commands and
   budget before compilation. Use the same strict source configuration and
   explicit populated typeRoots, never an empty type root. Prospective commands
   below use a fresh future directory; they have **not** been executed:

```sh
NODE=/Users/kjopek/.nvm/versions/node/v22.22.2/bin/node
REPO=/Users/kjopek/Workspace/safe-bash
CLEAN=/private/tmp/safe-bash-final-composition-20260829
TYPES="$REPO/tests/compatibility/bash-ere-core-transport-rebind-20260829/author-v3/type-tools/node_modules/@types"
CONFIG="$REPO/tests/compatibility/bash-ere-core-transport-rebind-20260829"
"$NODE" "$REPO/node_modules/typescript/lib/tsc.js" \
  -p "$CLEAN/source/tsconfig.build.json" --typeRoots "$TYPES"
```

Require compiler exit 0 before packaging. Enumerate all actual JS, source maps,
declarations and declaration maps; compare their origins and deltas against the
selected source versions. Do not assume the old 1002 or PUBLIC1014 member count.
Then, with cwd exactly `$CLEAN/source` and an explicit environment (PATH limited
to pinned Node, fresh HOME/TMPDIR/cache, LANG/LC_ALL C, TZ UTC, offline true,
ignore_scripts true, audit/fund false), run the trusted pinned development CLI:

```sh
"$NODE" /Users/kjopek/.nvm/versions/node/v22.22.2/lib/node_modules/npm/bin/npm-cli.js \
  pack --offline --ignore-scripts --json \
  --userconfig="$CONFIG/user.npmrc" --globalconfig="$CONFIG/global.npmrc" \
  --pack-destination="$CLEAN/package"
```

Recompute full shipping/private closure and freeze archive plus producer receipt
with exact size/hash in an atomic commit **before** admitting/decoding the same
Buffer. Source/type/compiled postchecks and bounded DATA layout binding follow
the already accepted repaired-producer procedure, not the old TS2688 outputs.

## Narrow existing-test smoke proposal

After a qualified build, use the existing authenticated test runner and copies
bound to the clean source/package, not live-HEAD imports. No new tests or fixtures:

- Existing `tests/shell/parser-regressions.test.ts`: select the continuation /
  keyword recognition and compound-command separator tests.
- Existing `tests/shell/runtime-regressions.test.ts`: select the bounded arithmetic
  short-circuit/update/overflow test and declarations/function-prefix test.
- Reuse the already-authored function-keyword K08/positional-arithmetic case and
  the smallest existing PIPESTATUS case selections from their current accepted
  fixtures when ROOT grants product execution; preserve their old observations.
- Reuse public Node positive/negative type fixtures at
  `tests/integration/node-public-author-20260829/types-positive.mts.fixture` and
  `tests/integration/node-public-author-20260829/types-negative.mts.fixture` for
  the exact root/subpath boundary. This does not run an engine or private provider.

Do not select pipeline-effects/positional-ifs native-comparison tests as a cheap
substitute: inspection found their bashResult oracle dependency. No new native
oracle authority is inferred. This smoke is not replacement coverage for 78
pending PIPESTATUS observations, CORE210 or public Node campaigns.

## Resource and review qualifications

Two distinct DATA/source helper files were authored. There were **three helper
invocations**, because the second helper first refused the reviewer canonicalization
assumption before spawning Git; that raw failure remains. Thus a two-invocation
interpretation of the helper allowance is **HOLD**, not a clean two-run claim.
The report does not hide this qualification or call itself independent proof.

Known OS roles including final publication: at most **36**, conservative peak 3.
The finite census before publication retained 8,351,931 logical bytes and
4,651,558 capture bytes; a 16,777,216-byte publication reserve yields **25,129,147
logical bytes**, below 192 MiB, and **21,428,774 capture bytes**, below 32 MiB.
This excludes Git physical storage, allocated disk blocks and RSS. Source/foreign
working files were not edited; publication uses explicit owned paths and
`git commit --only`, with before/after staged inventories retained.

Receipt: `READINESS-RECEIPT.json`, SHA256
`2484a0ef6e1379f379de767be53e525e77296b06fbc096ed8d80dc2f9d97e126`.
No product, Worker, compiler, npm, install or native oracle was run. Final verdict:
**listed-feature SOURCE preservation established; unified build/package proof
pending, with the manifest/docs and reviewer qualifications above**.
