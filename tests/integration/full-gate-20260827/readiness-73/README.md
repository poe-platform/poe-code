# Successor whole-gate readiness, not execution

Observation: 2026-08-27 17:38:56–17:39:15 UTC. Read-only committed inventory
`c355751f36ca3fdbab8f888eaab30203c1bcd343`, tree
`04d652efd8716b29877b6c928e4ed4c851babb55`. HEAD was identical at both ends.
This is an observed revision, **not an approved gate candidate**. No suite,
build, typecheck, packed consumer or product command ran during this task.
`INVENTORY.json` records full commit identities, ancestry, paths, hashes and
live status separately. `RECEIPT.json` authenticates the two observations;
the earlier observation is retained, not overwritten.

## Readiness verdict

Do not launch a successor whole gate yet:

1. The inherited mandatory native policy authenticates **48/49 assets**, not
   49/49: the installed Codex-supplied `rg` binary changed. Assets include source
   archives/files as well as executables; this is not a count of 49 utilities.
2. **11 committed `.mts` files are unclassified** (190 committed, 179 declared).
   The release inventory correctly fails closed. Classify each with real current
   compile/runtime routes or immutable authenticated historical provenance;
   do not blanket-exclude new files. The 19 strict /16 runtime /3 negative groups
   are configured routes, not executions of this snapshot.
3. Two current canonical registry fixtures still assert 70. Their migrations
   need an explicit approved name/capability set and preserved historical results,
   not expected values derived from `createAgentCommands()` itself.
4. Existing full-gate drivers/public smoke are revision-bound to b494/8670 and
   70 names. A versioned successor policy/driver, source envelope and 73-name
   package cohort are required; silently changing historical policies is wrong.
5. Meitner's public integration review is active; tree charset, expr shared
   worker changes and du are committed but not independently accepted at this
   observation. Root must decide the intended complete source cohort before
   freezing. TEMP owned-output work must not be promoted by a test overlay.

These are readiness findings, not new product failure counts. The five known
custom first-read expectations may remain red in an explicitly authorized
diagnostic gate; they are not a reason to skip failures or wait indefinitely.

## Committed inventory and package identity

- 600 canonical `.test.ts` paths versus 560 in 8670: 40 added, zero removed.
  Exact path lists and additions are in `INVENTORY.json`; no canonical path was
  excluded for being red or pending. Explicit runtime `.mts` consumers remain a
  separate required phase, not covered by this glob.
- 73 unique names in the explicit registry fixture. Both aggregate and root
  exports are byte-identical to author wiring `cb940da6`; that is static evidence,
  not a current-HEAD runtime proof. Curl/SafeJS remain optional; expr/du are not
  defaults. No shell-builtin count is inferred from the aggregate.
- Package `virtual-bash@0.0.0`, Node `>=22`, zero runtime dependencies.
  `package.json` SHA256:
  `691426f4934c471d2a76d49675f3fc19f3ddc47c8aa63cc38671d899a09c4535`.
  This is a **manifest hash**, not a packed-tarball hash. No pack was made here.
- Public integration's isolated candidate remains
  `3dc0ac26d681badfd4db6319f2630274095c3100`; author tarball
  `994dca37308937059b1adacade54f24bd8227589ad65c46c7f4fb661c702c9d5`.
  Meitner reviews that candidate, not this newer shared source. The explicit
  `./commands/grep-aliases` and `./commands/column` exports already exist;
  there is no general commands wildcard to assume.

## Source/fixture/harness admission map

Acceptance labels below summarize root-relayed scoped reviews and referenced
evidence, not new executions by this inventory. Full SHAs and baseline ancestry
are machine-readable in `INVENTORY.json.checkpoints`.

| Change | Source/fixture | Scoped review / qualification |
| --- | --- | --- |
| Direct rg iterator closure | `c27249c8` | `b8712221`; not in 8670 |
| Shared-input cleanup/primary failure | `3af3f628`, `f8819e9d` | `3ceac6f3`, `18c02655`; exact public fixture corrections, historical failures retained |
| Aliases and column prerequisites | `04644bc2`, `38cb670a`, `a8096354` | `3ceac6f3`, `491a98b9`; public wiring is separately pending |
| Numeric sort caches | `08a26051`, `b4fe4c78` | `3fe952ea`, `b6b2e96a`; bounded semantic/operation evidence, no wallclock claim |
| Env-S shebang / exact eight fixture migration | `ea409a6b`, `5ba1a0f3` | `01cc25f9`, `ec4e264d`; Linux argv MODEL, not kernel qualification; native17/23 retained |
| Curl zero host retry/redirect caps | `bb7f5972` | `32debb6a`; initial authorized request allowed, no new default networking |
| Allocation metadata / wrappers | `a3febbee`, `8991abc3` | `93355f81`, `8f19a9d5`; unknown versus zero; Linux execution unverified |
| Five split default evidence writers | `46abd879`, `79f11f15` | `e3d8f7e`, `ee0c60ea`; explicit unique-temp capture only |
| Strings native argv0 fixture | `8784a8fc` | `579c3225`; preserves expected bytes and binary |
| Compiler-config expectation fixture | `91d56dbe` | `3c56e36c`; exact approved exclusions, not broad omission |
| Node24 external admission | `6dc79cd5` | `c7489e14`; guarded-gate profile only |
| Consumer permission selection / explicit TAP | `774644f9`, `c800c899` | `8bd5baa7` component / `daf7ae4c` dispatch; historical helper29/30 unchanged |
| Explicit committed-archive admission | `6699804a` | `58130545`; strict-live refusal retained |
| Direct curl writer isolation | `5f7fe5d7` | `819e4105`; **already in 8670**, not a newly added fix |

Pending source must not disappear from the cohort merely because it is not a
default command:

| Pending item | Committed source | Effect on next gate |
| --- | --- | --- |
| Public aliases/column wiring | `cb940da6` | Meitner reviews isolated3dc0; source73 fixture migration is not self-approval |
| Tree charset | `f1a90436` | Existing default tree changes; reviewer holdout commits are not acceptance |
| Expr worker extension | `fe7083d9` | Changes shared regex protocol/client/worker used beyond expr; no safe assumption that nondefault means isolated |
| du author batch | `877144ea` | Nondefault source still built and four canonical tests still discovered |
| Owned-output S1/zero-cap overlay | `a61e63bc` | Test artifacts only; no production promotion, source patch must not enter archive implicitly |

The inventory also lists every source/root commit since 8670 and exact source
paths changed. Acceptance of an earlier feature does not certify a later edit
to the same source. Resolve pending review revisions at the actual freeze.

## Exact current fixture and type-inventory work

Current canonical numeric assertions needing intentional integration migration:

- `tests/commands/split/integration.test.ts:39` and `:45`: factory/installed70.
- `tests/commands/stream-format-author-stress/contracts.test.ts:19` and `:26`:
  factory/installed70 (title at17 also says70).

Leave unrelated corpus71 assertions and historical opt-in tree/file consumer
70/71 captures alone. Root's explicit73 name fixture already exists in
`tests/plugins/agent-commands.test.ts`; it is not evidence that these two older
current tests have been migrated. No assertion was edited during readiness.

Unclassified committed `.mts` paths:

1. `tests/commands/column-stress/current-contract-review/consumer.mts`
2. `tests/commands/column-stress/handoff-20260827/packed-types.mts`
3. `tests/commands/column-stress/padding-evolution/execution-20260827/packed-types.mts`
4. `tests/commands/grep-aliases-stress/verification/coverage-supplement/pipeline-holdouts.mts`
5. `tests/commands/grep-aliases-stress/verification/holdouts.mts`
6. `tests/commands/grep-aliases-stress/verification/public-consumer.mts`
7. `tests/commands/grep-aliases/consumer.mts`
8. `tests/commands/network-zero-caps-review/consumer.mts`
9. `tests/commands/network-zero-caps-review/mutations.d.mts`
10. `tests/commands/network-zero-caps-review/offline.d.mts`
11. `tests/commands/network-zero-caps-review/runtime.d.mts`

No existing sealed-data hash or listed path was missing/mismatched. This does
not pre-classify the eleven: even an apparent declaration stub needs exact
data/current routing and provenance. `inventory-check.mjs:6` requires exact
committed path membership; retained current consumers must keep same-package
binding and missing/source-fallback controls.

## Native and runtime profiles

The mismatched native origin is:
`/Users/kjopek/.nvm/versions/node/v22.22.2/lib/node_modules/@openai/codex/node_modules/@openai/codex-darwin-arm64/vendor/aarch64-apple-darwin/codex-path/rg`.

- Required rg SHA256: `4298efd414836892c913b2e87401d62fdd7c6ec4026d9bad8e3fab10557e411f`.
- Observed rg SHA256: `5d24e1af7efa7811e03df5555eeaa984bc8bd98ab42a5d49ecf30f163273e6c7`.
- Restore an authenticated retained old oracle or approve a separately measured
  new native profile. Do not replace expected identity just to admit the run.
- Pinned tree remains available at
  `/tmp/safe-bash-tree-external-oracle-TbVJVK/tree`, SHA256
  `34a794e5737d4b09a20a58dc0b7231e6300a3d229be5065c3a549969d205f10a`.
  Use explicit `TREE_NATIVE_BIN` and preserve source-archive provenance.
- The inherited49 are not an exhaustive inventory for the additional40 tests.
  New canonical expr requires pinned GNU9.7 `expr` and a C.UTF-8 behavior probe;
  new du has a live oracle row that explicitly skips if absent. Both binary
  hashes match locally (recorded under `additionalNative`), neither executed
  here; neither is in the old49 staging policy. Add exact staging/admission
  routes for the chosen cohort rather than let expr fail after launch or hide
  du behind missing-oracle skips. Du's frozen vectors explicitly qualify
  duplicate-operand/invalid-block-size/diagnostic differences; no full GNU claim.
- Alias canonical frozen BSD vectors do not require live grep by default.
  Optional BSD/GNU live replays use explicit flags and have disclosed skips;
  enabling them requires their captured binary/profile identities. Column's
  frozen native cohort has exact/qualified/unsupported classifications, not a
  new live-native pass. Preserve those denominators.

Qualified external gate runtime: Node24.11.1 Darwin arm64,
`/Users/kjopek/.nvm/versions/node/v24.11.1/bin/node`, SHA256
`4255a388254ca4319e2f95f1da375d5deaddf25baf9c7c85070b67f9543b15d0`.
Its identity, guard and TypeScript hashes match now. The actual guarded feature
probe was **not rerun**; do it against the final archive before launching.
Keep direct/PATH children on the qualified binary, permission feature probing,
positive consumers, forbidden FS/source reads, explicit TAP reporter before
test paths, and finite mandatory test counts. Unknown flags/NaN are not denial
or success. Runtime inspection invokes a trusted host binary before hashing;
it is qualification, not an untrusted-executable sandbox.

Node22.22.2's historical loader-hook failures remain separate from product
Node>=22 compatibility. Use `typecheck:all` (one build followed by source and
current strict groups); plain cold `typecheck` has documented prerequisite78.
No current cold/warm typing score is asserted here. Actual SafeJS availability
must be checked at freeze using isolated regular copies without private writes,
or actual skips disclosed. No private-engine inspection/copy ran in this task.

## Binding, writer safety and successor assembly

1. Root chooses a complete committed cohort after pending reviews, or explicitly
   authorizes a diagnostic cohort with named pending/red boundaries. Prefer a
   real committed revision containing the intended fixes. An assembled cohort,
   if separately authorized, needs its own real commit and full exclusion/path
   receipt; it is not HEAD or the complete current product. No assembly occurred.
2. Create a versioned successor policy/driver without editing old8670/b494
   receipts. Bind source SHA/tree, every selected Git blob, canonical path list,
   current consumer mapping, native assets, tooling and external verifier SHA.
   Existing `scripts/verify-whole-gate.mjs` still routes the b494-specific driver;
   existing8670 driver/public smoke still demand70. Neither is a generic next-gate
   command. Keep explicit archive admission and strict-live mode distinct.
3. Derive cleanup envelope from that exact committed candidate. Historical8670
   has220 inputs; this observation computes **244**, including new source/docs,
   package/config and unchanged cleanup fixture/probe/helper. The244 envelope
   is readiness data, not an approved launch manifest. Reusing220 would omit
   current inputs. Supply `VIRTUAL_BASH_PUBLIC_CLEANUP_EXPECTED` and
   `VIRTUAL_BASH_PUBLIC_CLEANUP_COMMIT` matching the actual freeze, never moving
   HEAD or an old4bb/8670 manifest. The script exactly reconstructs old220 as a
   control; it does not alter the historical file.
4. Require native admission before any suite, concurrency2, exact module paths,
   same-package declarations, explicit runtime groups and moved73-name public
   checks/fallbacks. Bind package.json and tarball hashes as different artifacts.
   Preserve all failures/skips and per-owner routing; no product edits mid-run.
5. Default split/direct-curl writer sources are unchanged from their accepted
   fixes (seven checked files including the capture helper). Leave capture flags
   unset; explicit `VIRTUAL_BASH_SPLIT_CAPTURE=1` writes to unique OS-temp output,
   not repository evidence. No capture flags were inherited here. This static
   source match is not a universal no-write proof for600 canonical files.
6. Admission's fresh archive check validates exact file/directory membership,
   modes, regular files and symlinks against Git. The existing runner's later
   `verifySource()` only visits expected paths: it detects changes/deletions but
   **does not detect unexpected added entries**. State that limitation; a
   successor claiming append-proof integrity needs a tested post-run membership
   check with explicitly allowed build/scratch outputs, not a broad ignored tree.
   Before/after bytes alone also cannot prove no identical-content write attempts.

Expected remaining custom first-read production failures, not silently waived:
`tests/shell/remote-close.test.ts` rows `first-read-local`, `first-read-s3`,
`first-read-webdav`, `first-read-curl-body`, `first-read-curl-headers` (each prefixed
`hard-deadline pipeline close: `). S1 artifacts do not certify their production
closure. No prototype patch may enter the candidate as an undeclared overlay.

## Preserved evidence and checks performed

- Whole8670 remains raw17454 pass/12 fail/0 skip **unqualified** (`d98b8321`),
  not rescored by subtracting later fixes. Separate package evidence2de7d99c
  passed16 runtime/19 strict/3 negative groups and four fallbacks; not a whole gate.
- Historical package.json SHA2127bbfe… and tarball SHA96d8256f… identify different
  artifacts, not an unexplained change to one artifact.
- Read-only checks here: two explicit Git inventories, asset content hashes,
  one Node24 identity child per inventory, syntax check of the inventory script,
  exact accepted writer-source comparisons and committed-data verification.
  No full suite, service, native semantic probe, build or package run.
- Reproduce a new observation with a **new isolated output path**:
  `node tests/integration/full-gate-20260827/readiness-73/inventory.mjs /tmp/unique-readiness.json`.
  It observes then-current HEAD and refuses overwriting output; it does not
  reproduce the old observation's current-host availability. Verify sealed data:
  `node tests/integration/full-gate-20260827/readiness-73/verify.mjs`.

Root source/manifest/exports remained untouched and clean during this task;
foreign untracked review/native paths remain preserved. Only this readiness
evidence, timestamped ledger and the durable allocation rule are owned changes.
No superiority, complete feature support or whole-product acceptance is claimed.
