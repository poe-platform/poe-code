# Literal original-thirty replay — August 26, 2026

## Checkpoint

**14 pass / 16 fail / 30 selected; zero selected skips, cancellations, or TODOs.**
Final capture: 2026-08-26T22:38:51.070Z. This is literal historical test replay, not
the reconciled GNU acceptance cohort owned by the separate frozen verifier.

| Original category | Selected | Pass | Fail |
| --- | ---: | ---: | ---: |
| GNU selector defects | 12 | 12 | 0 |
| GNU range/fuzz defects | 2 | 2 | 0 |
| GNU C0 native-native gates | 6 | 0 | 6 |
| Apple reverse-corruption gates | 5 | 0 | 5 |
| Parser-native gates | 5 | 0 | 5 |
| **Total** | **30** | **14** | **16** |

The historical full baseline remains **2,909 pass / 30 fail / 2,939 total**.
Do not infer a new full-cohort count by adding these fourteen passes: the other
2,909 original tests were not replayed. No native failure became an exemption.

## Frozen identity and provenance

- Historical tests/helpers/fixtures/config: `b92841a8ceaba9fb1f9c8c7915e218f880a9d1ed`.
- Complete committed product source: `695eb079c223077da2010872d59effdff15b17f3`.
- Source tree: `7060bce4a613c3645a466e739e63e852f9f14b5c`; diff-patch tree: `c5002961f967306dbb37d2965bad24930e89528e`.
- `patch.ts` SHA-256: `b344c6f7b0f6afaccdab75778a12c11c868d7f8bccd5d453c56e552039e619fe`.
- Exact-name census: `476da9d6b26a91919cd36003bf8320eae30a11b6`; its three raw baseline TAP hashes were revalidated.
- 368 historical files and 117 complete source files match their Git blobs and before/after SHA-256 manifests.
- Every archived file is read-only; all source directories are read-only. Historical snapshot was not modified.
- Every committed diff-patch file also matches the live root before/after; unrelated uncommitted shell/network files are excluded.
- Static TypeScript import closure covers 50 files with zero escapes: all non-builtin imports resolve inside the new snapshot.
- No absolute live-source imports or package self-imports appear in that closure; no loader instrumentation alters original flags.
- Tooling link resolves only to `/Users/kjopek/Workspace/safe-bash/node_modules`. Node v22.22.2, darwin/arm64; tsx 4.23.12, TypeScript 5.9.3.

`manifest.json` records per-file original test/helper and full-source hashes,
exact argv/environment, oracle versions/hashes, per-case results, and raw-log
paths/hashes. Full 368-file historical manifests remain in the isolated evidence.

## Exact remaining names

| Original literal name | Current failure reason |
| --- | --- |
| `native-native control context/delete-3/C0` | GNU patch exit 2: replacement text or line numbers mangled in hunk at line 4; native forward expected exit 0. |
| `independent formatter context/delete-3/C0` | ORACLE BLOCKED: Apple reverse returned incorrect original bytes; product cross-check blocked by original native gate. |
| `native-native control context/delete-7/C0` | GNU patch exit 2: replacement text or line numbers mangled in hunk at line 4; native forward expected exit 0. |
| `independent formatter context/delete-7/C0` | ORACLE BLOCKED: Apple reverse returned incorrect original bytes; product cross-check blocked by original native gate. |
| `native-native control context/delete-11/C0` | GNU patch exit 2: replacement text or line numbers mangled in hunk at line 4; native forward expected exit 0. |
| `independent formatter context/delete-11/C0` | ORACLE BLOCKED: Apple reverse returned incorrect original bytes; product cross-check blocked by original native gate. |
| `native-native control context/repeated-alignment-0/C0` | GNU patch exit 2: replacement text or line numbers mangled in hunk at line 4; native forward expected exit 0. |
| `native-native control context/repeated-alignment-7/C0` | GNU patch exit 2: replacement text or line numbers mangled in hunk at line 9; native forward expected exit 0. |
| `independent formatter context/repeated-alignment-7/C0` | ORACLE BLOCKED: Apple reverse returned incorrect original bytes; product cross-check blocked by original native gate. |
| `native-native control context/repeated-alignment-11/C0` | GNU patch exit 2: replacement text or line numbers mangled in hunk at line 9; native forward expected exit 0. |
| `independent formatter context/repeated-alignment-11/C0` | ORACLE BLOCKED: Apple reverse returned incorrect original bytes; product cross-check blocked by original native gate. |
| `normal-tab-prefix` | GNU patch exit 2; expected new\n, actual old\n. productIssues: []. |
| `normal-suppress-blank-empty` | GNU patch exit 2; expected \n, actual old\n. productIssues: []. |
| `normal-unsafe-integer` | GNU oracle exceeded 3000 ms; caught as assertion failure, not a selected-test cancellation. productIssues: []. |
| `GNU-normal-suppress-blank-empty` | Native-only GNU patch exit 2; expected \n, actual old\n. |
| `GNU-context-zero-middle-deletion` | Native-only GNU patch exit 2; target remains left\nremoved\nright\n instead of left\nright\n. |

GNU-native and Apple-native outcomes are separate evidence. Six C0 tests fail
GNU-native forward assertions. Five formatter tests fail original Apple reverse
byte gates before product cross-checks. Three parser cases explicitly retain
`productIssues: []`; their native failures do not become product successes.
The two other parser failures are native-only controls.

## Exact recovered names

| Original literal name | Current result |
| --- | --- |
| `golden diff flags: short explicit context then short format` | Pass, original assertions unchanged |
| `native diff flags: short explicit context then short format` | Pass, original assertions unchanged |
| `golden diff flags: short explicit context then long format` | Pass, original assertions unchanged |
| `native diff flags: short explicit context then long format` | Pass, original assertions unchanged |
| `golden diff flags: long explicit context then grouped format` | Pass, original assertions unchanged |
| `native diff flags: long explicit context then grouped format` | Pass, original assertions unchanged |
| `golden diff flags: format then explicit context control` | Pass, original assertions unchanged |
| `native diff flags: format then explicit context control` | Pass, original assertions unchanged |
| `Shell+Memory repeated format options retain GNU maximum context` | Pass, original assertions unchanged |
| `GAP-01 raw selected-oracle Apple-range compatibility reverse` | Pass, original assertions unchanged |
| `GNU boundary anchoring: asymmetric non-EOF rejection` | Pass, original assertions unchanged |
| `option interactions -C0 -c/labels=false` | Pass, original assertions unchanged |
| `option interactions -C0 -c/labels=true` | Pass, original assertions unchanged |
| `GNU selector regression: -C0 followed by -c resets to three lines` | Pass, original assertions unchanged |

## Source fixes versus cohort changes

- `05dee32`: product GNU selector source fix (`diff.ts`, `diff-format.ts`); all twelve original selector assertions now pass.
- `d05c582`: product literal empty-coordinate/asymmetric-fuzz source fix (`unified.ts`); both original range/fuzz assertions now pass.
- These family attributions follow inspected commit diffs and the historical classification; this replay does not bisect intermediate commits.
- `6bbf6a0`: later GNU oracle binding/native-calibration test changes, not source fixes.
- `075bda4`: later explicit atomic-policy test/cohort migration, not source fixes.
- `ca64971`: later GNU metadata/creation/overlap gate reconciliation, not source fixes.
- None of those changed test/helper expectations are used here: all tests come from the original baseline.
- Current source also includes later product changes through `695eb07` (failed-deletion reject orientation). This thirty-case subset does not independently establish the broader followup claims.

An unchanged reconciled acceptance run may correctly pass its own pinned
expectations, but that does not mean these sixteen literal original gates pass.
The separate final verifier owns that acceptance count; this report neither
duplicates its cohort nor substitutes a selected-profile number for original30.

## Reproduction and native isolation

Run from the requested root:

```sh
node tests/commands/diff-patch-stress/original-thirty-replay/replay.mjs
```

The reproducer requires the existing pinned binaries, Git objects, original raw
checkpoint evidence, and root development tooling; it installs nothing.
It extracts a fresh `/tmp` snapshot, preserves complete original tests, overlays
only committed `src`, and adds an anchored escaped literal-name selector to
the original direct Node invocations. Formats/parser retain their original
`--test-concurrency=1 --test-reporter=tap`; compatibility/fuzz retain their
original default runner options. All retain `--unhandled-rejections=strict`,
`--import tsx`, and `--test`. Original suite runners are not invoked, so no
compiler/build or broader acceptance suite runs. No `.test.ts` is added.

All five original GNU environment pins are retained. `PARSER_EVIDENCE` remains
unset, exactly as the corrected original parser run. Historical unused
`GIT_DIR`/`GIT_WORK_TREE` values are retained; selected direct tests never invoke
Git and always execute in the fresh snapshot. There is no fuzz-index filter
or injected `NODE_OPTIONS`. Apple controls still call `/usr/bin/diff` and
`/usr/bin/patch`, never rebound to GNU.

Unmodified native helpers use bounded processes, literal fixture filenames,
controlled working directories, and fixed C-locale/UTC child environments.
Formats creates fresh `/tmp/virtual-bash-formats-*` roots; other selected native
fixtures live under the new snapshot. No selected fixture targets host-escape
paths. Native oracle execution is test-only, not a product fallback.

Node 22.22.2 suppresses nonselected cases rather than printing skip rows here.
Raw TAP includes **seven empty-file harness passes**: compatibility 3, fuzz 3,
formats 1. Those are not selected cases. Thus raw totals are **37 rows / 21 pass
/ 16 fail**, while the literal denominator is **30 / 14 pass / 16 fail**.
Nonselected harness skips are zero; selected skips/cancellations/TODOs are zero.

## Evidence

Final isolated evidence root: `/tmp/safe-bash-original-thirty-replay-0zooF0`.

| Raw stdout | SHA-256 |
| --- | --- |
| `compatibility.stdout` | `7e2ad642f7571832a158e9bed8e23d8fca56a889e00eb3d562f6f06f79946021` |
| `fuzz.stdout` | `ff3c5f30c324df06528d3d97bef15ec9b4d75f88fd2d883854891bfdfe8872db` |
| `formats.stdout` | `45e03877249be99c7fce2763620a713fe6ee1dbb89c692f8d9da51236a7ec354` |
| `parser-regressions.stdout` | `5ef7f2a416b5bd5681f4af4f23ab36a22127b181478a41b5bb2ebc2c777d3bc6` |

All four stderr logs are empty. Before/after full manifests share SHA-256
`c18cf3816f17f7b7efd656d4d8f950156803e1b94b9257fdb311628e4f7c92d6`.
Preliminary literal-only captures produced the same 14/16 counts; their paths
and the unused Git-environment difference are preserved in `manifest.json`,
not combined into the thirty-case denominator.

No source fixes, existing-test edits, native reinterpretation, root documentation
edits, build, compiler check, or broad suite validation were performed here.
