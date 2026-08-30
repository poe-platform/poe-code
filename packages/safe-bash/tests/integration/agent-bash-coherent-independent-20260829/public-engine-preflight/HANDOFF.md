# PUBLIC95 coherent preflight bindings

2026-08-29. **SOURCE/DATA handoff, not runtime acceptance or execution GO.**
No compiler/build/product/Worker/engine/guest/network/private execution. No
Curie fixture edits or expected-index-hash investigation. Current coherent
composition remains309 inputs / tree3adc676a0ab638c9788ef007e465931d65d2c6fe;
1014 package members are predicted, not built.16 unchanged Node files do not
qualify their interaction with the accepted new core.

## Immediate answer for Curie

Use the **existing committed, accepted author INPUTS archive**, not a guessed
compiled directory or a new engine build. Select exactly its `engine` array:
**96 entries =95 emitted JavaScript files +1 package.json**.95 means94 engine
emissions plus the required host FsError support emission. Keep
`compiled/support/errors.js`; filtering only `compiled/engine/` reproduces the
old author setup refusal. Copy those96 entries into a fresh owned fixture root,
removing only the literal `compiled/` prefix, and place the authenticated normal
adapter at that root. See PUBLIC95-BINDINGS.json for every exact file/hash/edge.

At immutable `aed62f65`, no file named PUBLIC-ENGINE-RECEIPT.json exists anywhere
in the coherent author subtree: m05-INVENTORY.json records the full subtree.
The v3 handoff's description is therefore not a usable existing receipt locator.
This sidecar supplies exact provenance and field bindings; Curie still needs
to publish its own selected closure/materialization receipt. This does not
diagnose or change Curie's separate fixture-expected-hash issue.

## Durable records and hash domains

All paths in this section are repository-relative, not live scratch locators.

1. Accepted public Node evidence commit
   `30ac56acbf12a69b90e1923810958bcbcf367fe0`:
   `tests/integration/node-public-author-20260829/HANDOFF.md` and
   `EXECUTOR-v4.json`. The executor has `files[]` records with `path`, `bytes`,
   `sha256`, plus `acceptedNodeInputs[]` with explicit authority strings.
   It is not an engine-file array and does not contain emitted bodies.
   Independent actual acceptance provenance is
   `27f557ad6a18e06da5438e0d08d8b7ec2a703d94`, same-named independent REPORT.md;
   ROOT public opt-in acceptance6f449bf4 remains qualified, not new-core proof.
2. At that same30ac commit, the exact reusable body is
   `tests/commands/node-author-20260829/validation-v2/author-v5/INPUTS-v1.json.gz.base64`:
   **1939657 encoded-file bytes**, SHA256
   `18a3bf6ebf467f3c76a7c0b04c9c72a57f22d21e00ef4d58267c90d0403871c4`.
   After authenticating that same Buffer, base64 decoding yields1454742 gzip
   bytes, SHA256
   `014ebf5c1f325c9f7288e8cb55970bd41bf02604ee727089d0bdb07655692c3c`.
   Bounded gunzip uses16MiB maximum output. JSON schema is
   `node-author-input-archive-v1`; fields include `baseline`, `engine`, `tools`,
   `toolVerification`. **Do not overlay baseline278 onto coherent309.**
3. `engine[]` records contain `target`, `source`, `bytes`, `sha256`, `inputRole`,
   optional `commit`, and base64 **`body`**. `source` is historical provenance,
   not a path to open now. `target` is the exact staged namespace. Package
   metadata lacks the emission `commit`; do not invent one. This sidecar checks
   every decoded body against its byte/hash pin and all95 against the original
   compiler publication and its Git inventory.
4. Compiler publication `463a945125b900cbb98436b9e9292d78ca6c98aa`:
   `tests/commands/node-worker-experiments-20260828/preparation-v4-compiler/EMISSION-RECIPE.json`
   and `run/EMITTED.json`. Recipe SHA256
   `edafdfa33c252ed1e34a661bc65c4fe691b370f48afcd678759d4c115ac66e5c`.
   `modules[]` binds `source`, `sourceBytes`, `sourceSha256`, `output`, with
   `support:true` on the separate FsError source. EMITTED has `files[]` with
   `path`, `source`, `sourceSha256`, `bytes`, `sha256`, `sourceMapText`, and a
   `graph[]` of exact imports. Actual95 inputs/1076164 emitted bytes/zero syntax
   or options diagnostics; **TS5.9.3 transpileModule, NOT strict program checking**.
   No engine compilation is needed to reuse these immutable emissions.
5. Public source at the same463 commit:
   `tests/commands/node-worker-experiments-20260828/preparation-v3/PUBLIC98.json.gz.base64`,
   **461669 encoded-file bytes**, SHA256
   `8a65517b0105b3fbfb9337eda671442fa6c44d6b00185b98199ca05f17c2e637`.
   Eight-MiB bounded gunzip after encoded-byte authentication. Schema
   `public98-exact-core-source-v1`, commit
   `bb23ec270aaaf1d394b00d330fbf1aa6ccb2952e`, `files[]` has `path`, `mode`,
   `blob`, `bytes`, `sha256`, **`base64`**, and `proof.commitBase64` plus
   `proof.trees[] {sha,rawBase64}`. Paths are **packages/safejs-relative**, not
   monorepo-root-relative. This review checks the commit,15 proof trees and all98
   file/blob paths through that prefix. The source counterpart of the support
   emission is the separate `preparation-v3/inputs/errors.ts.data`, not an
   upstream engine file. No private checkout is involved.

## Exact staged closure and public provider

Let `$FIXTURE` mean the future owner's declared, fresh, regular-file-only
fixture root (not a path already admitted by this review):

- Each engine record goes to `$FIXTURE/` + `target.slice('compiled/'.length)`.
  This yields `engine/dist/**`, `engine/package.json`, `support/errors.js`.
  Do not flatten the support directory. Do not symlink to old author scratch.
- Normal adapter, at30ac:
  `tests/commands/node-author-20260829/validation-v2/author-v5/engine-adapter-v1.mjs`,
 1484bytes, SHA256
  `2108bf2e7eee28ecd16c7e644c0684518cbfd68219c2971d2df67b155bf4e80d`,
  goes to `$FIXTURE/engine-adapter-v1.mjs`. Its exact static import is
  `./engine/dist/core.js` (`run`, `Budget`), the public ./core export target,
  not an inferred private ABI. The source entry is `src/core.ts`.
- The adapter's frozen ABI is `NP1-ENGINE-PUBLIC-SYNC-1`, identity
  `author-public-bb23-node-adapter-v1`. Public construction already exercised:
  `createNodeWorkerProvider({entry:pathToFileURL(adapterPath).href,
  identity:'author-public-bb23-node-adapter-v1',observe})`.
  `entry` is the **adapter URL**, not product worker-main.js. Identity and URL
  are trusted configuration, **not byte authentication or host authorization**.
  Explicit command grants remain separate and default denied.
- The actual application Worker entry comes from the fresh selected package:
  `$PACKAGE/dist/commands/node/worker-main.js`. Bind its emitted hash from that
  package, not an old source/directory. The static adapter is test-side only,
  never a package dependency or vendored engine.
- The adapter uses existing Budget maxSteps100000/maxCallDepth128 and a262144
  byte combined context-prefix/program admission. It does not change the
  command's fixed limits. Promise constructor, ESM/.js/TLA/npm/npx/async fs/
  process.exit/package search remain unsupported; Worker-L is not all-jobs/RSS.

PUBLIC95-BINDINGS.json records all95 source/emission mappings, package metadata,
adapter/guard hashes and10 exact external importer edges from the compiler graph.
They are host-only scoped edges (`node:crypto`, `node:async_hooks`,
`node:fs/promises`, `node:path`, `node:util`), **not a guest/global allowlist**.
SOURCE-EDGES.json retains the whole95-module static graph. Fresh product and
fixture imports also need admission; authenticating only the engine is insufficient.

## Existing instrumentation: reuse rules, not old execution scope

At30ac, `tests/integration/node-public-author-20260829/` contains:
`node-policy.mjs`, `node-load-guard.mjs`, `internal-loader-arguments.mjs`,
`node-batch.mjs`, `public-node-v2.mjs`, `run-v3.mjs`, `run-v4.mjs`.
Their exact executor pins and selected bodies are captured in this sidecar.
The internal-loader helper is byte-identical at several accepted executor paths;
the generated content-pin table names the first matching strict-mode locator.
Use the explicitly named public-author locator above when staging that recipe;
do not infer a different required subtree from a duplicate-content hash.
The old runner-node.mjs.data fragment still has the original engine-only path
test; **run-v3.mjs:136** is the corrected actual inclusion of
`compiled/support/errors.js`. Do not execute or transplant that obsolete fragment.

Existing `node-policy.json` fields are `log`, `maximum`, `workerEntry`, `adapters`.
The policy observes create/exit, refuses nested application Workers and verifies:
empty env/argv; stdout/stderr true; resourceLimits old32/young8/code8/stack4MiB;
workerData exact `request,entry,identity,sab`; SAB197056bytes; request exact
`profile,selector,source,program,filename,cwd,argv,env,grants,limits` and
NP1-CJS-WRQ-L-SYNC-1. Rebind log/entry/adapter paths to each owned layout.
The raw adapter identity check alone is not a file hash guard.

Existing `load-manifest.json` is `{files,aliases}`. `files[]` contains absolute
`path`, `bytes`, `sha256`, `builtins` (plus inventory metadata); aliases map the
root and exact commands/node import to that layout's actual emitted files.
`node-load-guard.mjs` uses registerHooks, requires regular non-symlink files,
checks size/hash before import (262144bytes/file), checks per-importer builtin
edges, rejects unlisted bare package fallback/query/fragment, and emits
`@@NODE_LOAD` records. The manifest itself is bounded2MiB, loads2048. The
guard/policy bootstrap files and their config must first be outer-authenticated;
self-declared identity is not admission. Refresh and compare complete membership,
not only previously present paths, after materialization and every move.

The old application consumer argv is exactly shaped as:
`NODE --experimental-permission --allow-fs-read=OWNED_ROOT
--allow-fs-write=OWNED_ROOT --allow-worker --import POLICY --import LOAD_GUARD
ENTRY INPUT_JSON`. This is historical scaffolding, not an executable GO here.
Policy/guard startup and inherited Worker imports need the exact bounded paths.
Do not duplicate a permission prefix when adapting an already wrapped loader.
`internalLoaderArguments` separately recognizes a fixed `--loader` consumer
shape; fixed loader admissions are not application Worker starts or observed
individual loader exits.

Using old node-batch.mjs also imports focused-v5/workers-v5/public-node.mjs
regardless of role, so that complete helper closure must be copied and bound;
the corrected public-node-v2 bytes are staged under the imported public-node
basename in the versioned recipe. Curie's five workflows need not invoke that
whole legacy runner. Do not call nodeLayout and silently add61/24 cohorts or
their Worker allowance. Existing full-suite source/installed/moved results are
inherited evidence, not a fresh coherent replay.

## Layouts, tools and remaining preflight work

The accepted recipe builds selected source, packs fully, installs offline with
scripts disabled, and physically renames the installed parent. Source-built
means product emissions from the selected source, not TS fallback. Each layout
must get a fresh packageRoot/moduleRoot, Worker entry, load manifest/aliases,
static adapter URL and fresh captures. Owned engine regular-file copies may
remain under a separately declared fixture root; their unchanged hashes must
still be checked. No symlink or old installed path may rescue moved resolution.
Alias-loader evidence is not native package-export selection: preserve the
separate native package resolution/type checks from the accepted public review.

Archive `tools.node` gives the existing v22.22.2 path,112989184bytes/SHA
`5c899797c4eb8f1db5563eea56538342ddb3e9276ee1b04a5a1f0f1023d2b011`.
Other `tools` values bind TS5.9.3/npm10.9.7/@types/node22.20.1/undici-types6.21.0,
with tuple `rows=[relativePath,modeNumber,bytes,sha256]` and `origin` paths.
They are metadata, not embedded tool bodies or promises those paths still exist.
Curie's fresh object-row inventory has a different serialization domain: compare
individual file pins, not tuple-array JSON hash against object-array JSON hash.
Fresh bounded type/size/hash checks of every actual tool copy are still required.

Smallest remaining author work, without changing engine/version/profile:

1. Publish the selected96+adapter closure and precise archive/encoded/gzip pins;
   materialize only in a fresh authorized owned namespace, with exact path/mode/
   byte census. Mode is not an engine-array field: declare staged modes rather
   than claiming an absent pin. Keep coherent309 source separate from baseline278.
2. Complete Curie's own outer supervisor, builder and dispatch; bind all actual
   tools/fixtures/Worker/guard/config/importer paths before any import. Regenerate
   manifests from authenticated selected inputs, never a permissive HEAD glob.
3. Produce and authenticate the fresh full1014 package if it actually has1014
   members. Its SHA/member count remain UNKNOWN until built. Check exact encoded
   bytes before same-buffer inflate; preserve the old N14 admission-order caveat.
4. Obtain the separately required engine GO. The proposal has15 planned launches
   (five workflows×three layouts),18 Node Worker ceiling and12 fixed loader
   admissions, no RegexWorkers. That proposal is not current authority and does
   not include E07/E08 or61/24 reruns. Count raw Worker creates/exits, guest-entry
   observations, loader admissions and OS admin roles separately; no universal
   process/peak claim. Preserve primary falsy reasons and cleanup-before-credit.
5. Retain all50 Unit2 identities/layout once, C17's nonasync exact invoke Promise,
  13 engine-free workflows and the explicit engine slice. Unchanged Node files
   do not replace these new-core interaction tests. Stop on integrity/capture/
   unknown retirement; no absent-engine success or unbounded timer workaround.

## This sidecar's evidence and qualifications

DATA extraction v2 authenticates98 public source paths through15 proof trees,
95 carried emissions and all96 archive entries, plus exact coherent source hash
`ef0b79dbd30cebec3f8b939a98928b9441947ff4be724e5031b2ee03925f26ae`.
It does not freshly execute/typecheck/recompile the engine or prove local tool
availability. No new public API, builtin grant, provider implementation or guest
feature is proposed. Static accepted engine provenance is reusable; new-core
runtime acceptance is not inherited.

Original locator/presentation/extractor helper errors remain in LOCATOR-HISTORY
and EXTRACTION-HISTORY with captures and exact reversible namespace correction.
No author record is repaired or rescored. The missing coherent receipt is a
concrete materialization/binding task, not evidence that PUBLIC95 bytes are lost.
