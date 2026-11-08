# Immutable bindings and exact fifteen-row ledger

2026-08-28. SOURCE/DATA only. Symbols below bind every source citation in
ASSESSMENT.md; an unprefixed product/test path there means **F**, not live HEAD.
Paths are repository-relative. No subject module was imported or evaluated.

| Symbol | Full commit | Role |
|---|---|---|
| F | `f5e9fc49b6abb38e180cc9de16c95fced102ff75` | Fixed product/source snapshot |
| A | `7815257fd918c557e4af19f107af226112224a5c` | Curie's held-boundary diagnosis |
| D | `682aad1292eac3dc82a2c15a48b9f0c6ec9c5628` | Prior independent diagnosis v19 |
| V | `2434ae624c8241d835cb08cf21c2c75591c070a9` | Prior independent repair review v20 |
| R | `c23a8de855f4f51423ee21c35ef5bbcc4d2d56a5` | Original R3 captured result |
| L | `f03c260269dfd8ee10666f7fd2560655f8e14a38` | Original shipping launcher source |
| S | `437778996f60109e212e20b1b242455866fda285` | Already-reviewed repair source |
| E | `2ae74702def6b06f1519c9a88c12d6f748611250` | That repair's author evidence |

Directory abbreviations:

- A-dir: `tests/integration/full-gate-20260827/unified76-driver/r3-held-boundaries-diagnosis`
- D-dir: `tests/integration/full-gate-20260827/unified76-driver-independent/r3-diagnosis-v19`
- V-dir: `tests/integration/full-gate-20260827/unified76-driver-independent/r3-repair-v20`
- R-dir: `tests/integration/full-gate-20260827/unified76-driver/released-run-v3-qualified-h11`
- L-dir: `tests/integration/full-gate-20260827/unified76-driver/launcher-v3`

R `R-dir/ROOT-RECEIPT.json:6` and D `D-dir/HANDOFF.md:15` bind the unchanged
expected package SHA256
`c109372f90b1bd19bcf756cf993bb2976fb52b75fe0c92a1cf96dab4c229b5cd`.
This is an expected package binding, not a new pack or live-tree equality claim.
R's packet is `69f5cc1b05484c9d0836edf77bfbbbfb46145383`; consumed authorization
is `021302a101371e7984e2244853f4f5e9f2c9778c`. No reuse is authorized.

## Exact mapping, all still FAIL

Ordinary jq joins confirmed all fifteen unique A `CROSSWALK.json` IDs have the
same exact name, sourcePath, status and detail SHA as D `CROSSWALK.json`.
The name column is JSON-quoted to preserve the empty-string row's trailing space.
Source keys resolve in the next table; groups retain the previous index.
Each raw-detail hash was independently recomputed from A `CAPTURES.json`
`.rows[id].detail` with jq raw/no-added-newline output and SHA256. No TAP replay.

| ID | Group/source | Exact original name | Raw detail SHA256 |
|---|---|---|---|
| tap-line-41671 | G04 / expr | `"inactive call checkpoint preserves abort identity: undefined"` | `d3004fb727b6c8c155be028a12c5f4a8a85eb7eafb40794beb1375b465d787ff` |
| tap-line-41692 | G04 / expr | `"inactive call checkpoint preserves abort identity: null"` | `5ee07960b7d0374db51ade8c7c0ed485dc05395a9052d87b67257fdbdd75496d` |
| tap-line-41713 | G04 / expr | `"inactive call checkpoint preserves abort identity: false"` | `a0dc65a19ca81e67303b1878c70458d2ab0afd3e8f0ee839ea37f3b9f08ed08f` |
| tap-line-41734 | G04 / expr | `"inactive call checkpoint preserves abort identity: 0"` | `5c6481462af9dad1f2bee102e5e07251520dbc04729013ad6d2feeffe2c39744` |
| tap-line-41755 | G04 / expr | `"inactive call checkpoint preserves abort identity: "` | `994e708427504923f24d0a589299c83405066615f0b753378e71365a166bce9a` |
| tap-line-41776 | G04 / expr | `"inactive call checkpoint preserves abort identity: Error: cancelled"` | `3d2d56c1398326ba66c50919e7e3ed373d1f0dff811624c362184be60266313a` |
| tap-line-46530 | G05 / chmod | `"GNU chmod directory setid controls compare actual host preservation"` | `27d0744b2f6fac9031853d569161f43e6c3d8cbda2a08df70c5e10a7302601cb` |
| tap-line-46642 | G06 / differential | `"GNU chmod seeded symbolic/numeric differential: 384 mode transitions"` | `bff40531686af2485734521ce512b323fda8cbc7a201fd9b035b1065b92ba177` |
| tap-line-47423 | G07 / darwin | `"Darwin9.7/Node22 divergence characterization, strict GNU gap remains: requested06755 actual04755 +2000"` | `623fe08762fc2bcd1bbb86d79bfda948c66eecadaff1a6aba195819c46516805` |
| tap-line-47452 | G07 / darwin | `"Darwin9.7/Node22 divergence characterization, strict GNU gap remains: directory0051 ug+s"` | `852d2b037091f09d514a1a674ba336d2d12ef2d662e442d29dab9f3006196ba6` |
| tap-line-47489 | G05 / qualification | `"member-group fixture qualification precedes exact setid modes and permits genuine SGID success"` | `a62c82dd5f47a0ef54633359e55c1b4b0f7fdb6be506d8db3fb749222995e4eb` |
| tap-line-58752 | G10 / tac | `"live exact pinned native observations"` | `7394960eeedbefa4b2d32e0879bf1ea14f2d588bd3c6685c9645c9a3b8bb0690` |
| tap-line-99469 | G11 / socket | `"special filesystem nodes are rejected instead of pretending to be regular files"` | `9fb008a717fbdc35ead8783221fc644529a54581fe2d851f170781474b3847eb` |
| tap-line-109526 | G13 / npm | `"actual npm script excludes future native test data without excluding neighboring tests/helpers"` | `12cce4ff57ad0701a3ee91853e7422743d74eee6ff0a68f07195cdfd72c0e3dc` |
| tap-line-112555 | G14 / header | `"independent script entrypoint: strict-header-and-utf8-boundaries"` | `069beadeba0a4504881ba62d9264fcb05b2928a922f7f5c3963d8d33adcffd32` |

| Source key | F sourcePath / relevant line |
|---|---|
| expr | `tests/commands/expr/inactive-prefix.test.ts:191` |
| chmod | `tests/commands/metadata-stress/chmod-controls.test.ts:17` |
| differential | `tests/commands/metadata-stress/native-differential.test.ts:40` |
| darwin | `tests/commands/metadata-stress/permission-profile/darwin-profile.test.ts:18` |
| qualification | `tests/commands/metadata-stress/permission-profile/qualification.test.ts:18` |
| tac | `tests/commands/stream-inspection/native.test.ts:42` |
| socket | `tests/fs/real/adversarial.test.ts:225` |
| npm | `tests/plugins/qualified-current-release-native-data/controls.test.ts:197` |
| header | `tests/shell-stress/script-entrypoint/holdout.test.ts:22` (inner `cases.ts:134`) |

G04=6, G05=2, G06=1, G07=2, G10=1, G11=1, G13=1, G14=1: fifteen
source/data mappings, **not fifteen semantic passes**. Tac/npm remain included.

## Small authenticated evidence reads

The following committed bytes were SHA256-recomputed here and match the sealed
claims. A's five files total 144,963 bytes; no broad 114 MB capture reread or
retained-root/private content access occurred.

| Commit/path | SHA256 |
|---|---|
| A `A-dir/README.md` | `13987149307908a3fe894360c07ed3be7c3fc2166f791aa895c6a09a8fb5836c` |
| A `A-dir/CROSSWALK.json` | `29160bfbf2a1edc9cd506dc0b2eab60df8cf3f58d60584f77788f27be2441a6a` |
| A `A-dir/CAPTURES.json` | `1f005ec0299d466429d25ea2c0998a3ebf39cbfa429853916be321093a396284` |
| A `A-dir/DIRECTORY-MISMATCHES.json` | `c0317014a903a76b37ff0e5c5be4082343893c772c8b935d20a5a82ce2303e1d` |
| A `A-dir/SOURCE-BINDINGS.json` | `256792b1cfba29fe745d9fd12d5d0d6a90bb6f085a827cb9ec1f49cf1a5de8fd` |
| R `R-dir/RESULT-SEAL.json` | `f0f835a538242164440516e5c46499a4a5d58d46b0a95fa75ba93fc16bd33782` |
| R `R-dir/ROOT-RECEIPT.json` | `f61bace1ea85dc1aa19b8f80728cbc4526148fbca424ac452a818471c28dc847` |

A `SOURCE-BINDINGS.json.sources` supplies 33 commit/blob/SHA source bindings;
our citations use F objects directly, not copied snippets or current modules.
Additional necessary accepted-contract/profile objects read directly at F:

| F path | Git blob |
|---|---|
| `src/shell/cancellation.ts` | `a7742b7f7e81bcd8c1c2a6be35092d8b5f41102f` |
| `src/shell/types.ts` | `4684a5ad1f8b76c721a6f827646f289eda4c44ef` |
| `tests/shell/cancellation-stage1-20260827/README.md` | `02a7a3f791addbda98f4bafdd0016883af9a55ff` |
| `tests/shell/cancellation-stage1-20260827/accepted-fbbe1ef7-docs/ACCEPTANCE-CLARIFICATION.md` | `dd3338a30eb3c80ca32603763936d387cb9fef51` |
| `tests/shell-stress/env-split-holdout/README.md` | `6f2a184b1ecc4b09e9bcf9c8ab34372a653be063` |
| `tests/shell-stress/env-shebang-integration-review/GUARDED_EA409A6B_REVIEW.md` | `6fb9b8dfd33d493c18e2de19ff224077a764246d` |
| `tests/shell-stress/env-shebang-eight-migration-review/README.md` | `bd9282678356904c3d6d4e6f5880ed3a41224de0` |

## External primary source, documentation retrieval only

Retrieved 2026-08-28 through the web documentation tool, not a subject network
test or an OS/runtime probe. Node's official version-pinned source was read as
text, never evaluated; no claim that this retrieval authenticates the R3 binary.

```text
https://nodejs.org/download/release/v24.11.1/docs/api/globals.html
  AbortController.abort, AbortSignal.any, AbortSignal.throwIfAborted
https://raw.githubusercontent.com/nodejs/node/v24.11.1/lib/internal/abort_controller.js
  lines 195, 200, 237, 384, 406, 473
```

Node v24.11.1's `abort` parameter defaults to an AbortError DOMException when
omitted or undefined. Other supplied values become the stored reason;
`throwIfAborted` throws that stored value. `any` converts its input through the
AbortSignal interface converter. These facts support the prospective fixture
distinction; they do not decide virtual-bash's public support policy.

The Apple SDK/manual facts are **A's bound local-document evidence only**, not
fresh external/native guarantees: SDK `sys/un.h:79` SHA
`a733cb89955ef81312f4bc3a42002c6cc873e27381eb43656c7158ef9a433c24`, and
GNU9.7 `coreutils.texi` SHA
`39b126752866fff675e462bd44d76f3e034abafe462a069cebd53ef39fc53eca`.
Neither file nor any private/retained path was opened by this review.

## Review receipt and limitations

Criteria recorded 16:03:40Z after author work, before this review's diagnosis
body reads. Finite evidence hashes completed 16:09:26Z. Not blind/pre-author.
Administrative tools: Git object/status/index reads, bounded text searches and
line extraction, jq data selection/join, SHA256, literal-path byte counts, date,
apply_patch and explicit-path Git commit. Some initial JSON displays were too
broad/truncated; one unquoted glob and one guessed `phase.mjs` lookup failed.
These were source/data query errors, not subject executions; subsequent queries
used exact fields and `phase-runner.mjs`. No hypothesis was tested dynamically.

Raw R3 remains 19425P/132F/7skip, 6/14 stages, 928 captures; D
`D-dir/HANDOFF.md:37` binds the 286 added entries. No deductions/rescore.
V `V-dir/HANDOFF.md:16` retains one reviewer harness SyntaxError, zero checks
started/passed, all 53 planned checks UNEXECUTED; no retry occurred here.
There is no subject worker, build, test, native utility, product, helper,
declaration, private, OS-probe, gate or retained-root-cleanup execution here.
Only the three new review Markdown files are owned. Historical bytes, source
snapshot and expected package binding remain unchanged by this review; this is
not fresh proof of every live file or retained-root state.

Precommit check at 2026-08-28T16:15:03Z: HEAD had advanced independently to
`00bb4765459176dafc4b5c77fc97d2630c46a689`; no foreign commit was amended or
adopted as reviewed source. Global tracked status/index remained empty, and
only these three owned paths were new in this review directory. Scoped Git
comparisons found no tracked changes in A-dir, D-dir, V-dir or R's two small
root-receipt/result-seal files against their bound commits. This does not scan
new untracked entries there, rehash all 928 captures, or certify retained roots.
