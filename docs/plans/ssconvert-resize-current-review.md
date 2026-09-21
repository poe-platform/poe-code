# Current independent resize review

This separate agent reviewed and repaired the live candidate on 2026-09-20. The root owns exports, integration, Git and final cumulative verification. No README, commit, push or publication was made by this reviewer. Historical reviewer counts are not current qualification.

## Manual QA procedure

1. Authenticate `out/ssconvert-lifecycle/gnumeric-1.12.61.tar.xz` against official SHA-256 `2ac135d856572713c1a408b76b50a59f2a9769ed21f1213446b5af255df20a12`. Compare inspected extracted source bytes to the archive members. Keep primary source in `out`.
2. Read `src/sheet.c:gnm_sheet_resize_main`, `src/selection.c:sv_selection_add_range`, and `src/sheet-style.c:sheet_style_most_common`.
3. Create original small XML QA workbooks only under `out/ssconvert-resize-current-review`. Include one explicitly indexed 256-row/column sheet and selection120..150, selection200..210, and two surviving selection ranges120..150 and4..6 with rows5..7. Execute the separately built native1.12.61 container with the exact environment in `docs/ssconvert/resize-reference-profile.json`. Native tooling is QA only.
4. Decode gzip XML outputs; compare individual retained selection records separately from native default additional workbook views. Check native status and stderr. Repeat with nine local named expressions at parse baseGS201; inspect serialized expressions and preserved parse bases.
5. Run the original in-memory regression suite, including cancellation/work-limit and namespace negative controls. Unit tests neither launch native processes nor write files. Run maintained package lint. Root executes maintained final workspace build/test/integration routes and visible CLI screenshot inspection.
6. Purge reviewer-owned temporary input/output/log files from `out` after recording measured results here.

## Source authentication

Archive hash matched exactly. Extracted inspected members matched authenticated archive bytes:

| Member | SHA-256 |
| --- | --- |
| `src/sheet.c` | `dd06712b10126b59b2c42601878abc12fe29f08003bcfc0c7ec36b09bcc8059b` |
| `src/sheet-style.c` | `320727f09a5f54f94f2ffde7fc8340ae408749ddb3d321038776fd206e341f17` |
| `src/selection.c` | `f78bb08af133ee3b2d9db671a115b64bb64b0425df4aef473ff8fdfc301ed3ff` |

## Findings and measured cells

The first original in-memory selection suite had two failures and two passes before repair. Retained `Selections` ranges and cursor metadata survived shrinking without transformation; SDK `view.selection` could remain outside new dimensions. Source and separate native execution confirmed intersection with the new grid, fallbackA1 when all ranges disappear, and reset to the last surviving selection's start. Repairs live in `resize-records.ts` and the final sheet mapping in `resize.ts`; root retained reference callback ownership.

| Native QA cell, resize128x128 | Status | Stderr | Observed selection result |
| --- | --- | --- | --- |
| Range120..150 on both axes | 0 | empty | Range120..127, cursor120,120 |
| Range200..210 on both axes | 0 | empty | A1 range, cursor0,0 |
| Range120..150 followed by columns4..6/rows5..7 | 0 | empty | Original surviving order, cursor4,5 |

An initial probe without the captured reference environment produced GOConf warnings. It was investigated and rerun with the exact profile; its diagnostics do not qualify reference parity.

Independent local named-expression QA at disappearing parse baseGS201 produced status0 and empty stderr. All nine expressions retained GS201:

| Original expression | Native and product result |
| --- | --- |
| `A200` | `A72` |
| `$A200` | `$A72` |
| `A$200` | `#REF!` |
| `$A$200` | `#REF!` |
| `A100:A200` | `A72:A100` |
| `A200:$A$100` | `A72:$A$100` |
| `$IV100:$IV200` | `#REF!` |
| `IV200:A100` | `A72:DX100` |
| `A100:$IV200` | `A72:$DX100` |

The new current suite has eight passing tests. Together with root's named regression and existing resize/regression suites,25/25 passed in this review. New negative controls cover a foreign namespace cursor attribute preserved unchanged, dimension no-op preserving metadata, work exhaustion without resized success, arbitrary cancellation reason identity, unsupported foreign prototypes, and accessor refusal without getter invocation. The maximum supported16777216x16384 empty-sheet case retains zero cells and no row/column metadata; this is a deterministic sparse-structure check, not an RSS/performance measurement.

A cross-realm ordinary-object acceptance probe failed with `invalid-request: Unsupported workbook prototype`. Investigation confirmed shared snapshot admission intentionally accepts local ordinary/null prototypes. The test now verifies explicit refusal; foreign ordinary-object acceptance remains unsupported, not a compatibility pass. No shared-model policy was changed.

The maintained `npm run lint --workspace=@poe-code/ssconvert` route passed after selection repair and again with the final eight-test suite, including source/test TypeScript checks. Root records candidate-wide gates separately. No whole-workspace gate is inferred from this focused reviewer run.

## Remaining unverified and unsupported cells

Native equal-count style winners explicitly depend on pointer-hash order; product first-insertion tie winners are unqualified. Arbitrary native style semantic equivalence/partial-default inheritance, selection overlap simplification, frozen panes/scroll relocation, every print property, every object subclass/anchor mode, foreign exporter style losses and dynamic GLib PID/time diagnostic prefixes remain unverified here. Named nonzero-position mixed ranges above are measured; they do not certify every named expression or external workbook.

Foreign ordinary-object realm input is unsupported by current shared snapshot policy. Host authority, Shell checkpoint/replay/original execution, command/SDK byte publication and all shell budgets were not independently requalified by these workbook-only tests; root supplies relevant integration evidence. No native dependency/fallback or implicit host I/O was introduced. CLI screenshots, workspace builds, broad tests and final current lint belong to root verification. Unavailable and unsupported cells are not passes.
