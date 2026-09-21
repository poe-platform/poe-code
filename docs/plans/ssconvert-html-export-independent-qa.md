# Independent HTML export QA

Date: 2026-09-20. Separate stress agent inspected and tested the implementation after root implementation. No Git, README, provider, integration, or export changes were made by this agent.

## Reference and procedure

Primary Gnumeric source: `out/ssconvert-lifecycle/gnumeric-1.12.61/plugins/html/{html.c,font.c}` and `src/sheet.c`. Supplied archive SHA-256: `2ac135d856572713c1a408b76b50a59f2a9769ed21f1213446b5af255df20a12` (root owns archive verification/profile capture). URL dependency source inspected: `out/ssconvert-statistics-oracle/goffice-0.10.61/goffice/utils/go-file.c`.

QA-only oracle: Docker context `colima`, container `ssconvert-statistics-qa`, executable `/out/ssconvert-statistics-oracle/prefix/bin/ssconvert`. Environment: `GSETTINGS_SCHEMA_DIR=/out/ssconvert-statistics-oracle/prefix/share/glib-2.0/schemas`, `GSETTINGS_BACKEND=memory`, `LC_ALL=C`, `TZ=UTC`. Actual oracle dependency package names/version: `libglib2.0-0t64=2.84.4-3~deb13u5`, `libgtk-3-0t64=3.24.49-3`. Native execution stays separate from product and unit tests.

Create small original Gnumeric XML fixtures in `out/ssconvert-html-export-independent`, copy them to the oracle `/out`, and invoke each saver using `-T Gnumeric_html:<id> input.gnumeric output.html`. Compare output bytes with the same registry writers used by the product engine after importing the original fixture. The second comparison driver invokes actual `runCommand` with `createEngine`, injected input/output bytes and cancellation. The initial direct-writer comparison is supplemental. Do not substitute DOM comparisons for byte equality.

## Verified coverage

35/35 actual CLI/shared-engine native byte comparisons passed. Every native and product invocation exited 0 with empty stderr; output ordering and bytes matched:

| Fixture | html32 | html40 | html40frag | xhtml | xhtml_range |
| --- | --- | --- | --- | --- | --- |
| URL with reserved punctuation, space, percent, UTF-8 | Pass | Pass | Pass | Pass | Pass |
| 16-bit foreground/background color, centered alignments, fractional font size, italic/bold/double underline/Courier/strike/superscript, intervening blank cells | Pass | Pass | Pass | Pass | Pass |
| Same style and link with A1:B2 merge, covered cells omitted, later numeric cell | Pass | Pass | Pass | Pass | Pass |
| Comment B2 anchor with escaped comment text, body omitted | Pass | Pass | Pass | Pass | Pass |
| Valid 1×1 PNG C3:D4 anchor, body omitted, full extent emitted | Pass | Pass | Pass | Pass | Pass |
| Hidden row and column containing A1 | Pass | Pass | Pass | Pass | Pass |
| Nonempty A1:B2 merge plus blank C3:D4 merge outside extent | Pass | Pass | Pass | Pass | Pass |

Four independent unit tests passed via `npx vitest run packages/ssconvert/src/codecs/html-write-independent.test.ts`. Unit tests use in-memory workbook/XML input and memfs command input/output, with no native utilities or host file writes. The memfs case verifies hidden A1 cell export, B2 comment extent, empty stderr, exit 0, and unchanged input. Targeted ESLint passed. Cancellation preserves the injected error identity; an insufficient output budget rejects with the exact resource-limit diagnostic.

Two validated repairs were preceded by failing unit regressions and confirmed against native bytes:

1. Hyperlink URL escaping uses GLib's path reserved-character set, percent-encoding `?`, `#`, `[` and `]`, preserving permitted path punctuation.
2. Gnumeric 16-bit style colors truncate to their high byte rather than rounding division by 257. `00ff:01ff:80ff` becomes `#000180`; `ff00:7fff:0080` becomes `#FF7F00`.

## Remaining mismatch and unmeasured cases

One measured mismatch remains outside the 35 passes: default-font A1 string `abcdefghijklmnopqrstuvxyz abcdefghijklmnopqrstuvxyz` exports natively with `colspan="6"` while this writer emits a plain cell. Native `sheet_get_extent(TRUE, TRUE)` extends overflow spans using rendered metrics, and `write_row` emits the resulting colspan. This requires deterministic reference rendering/span behavior; it cannot be counted as a pass or inferred from merge parity.

Comment/image bodies and anchors, hidden row/column inclusion, and a blank merge outside the nonempty extent were exercised as recorded above. External-file links, partial range boundaries, all border styles, conditional style evaluation, formatted numeric colors outside named sections, and hostile resource-size extremes were not independently measured here. Root coverage, if present, must be recorded separately; these are not passes in this report.

QA capture files and comparison drivers are temporary `out` artifacts and should be purged after root incorporates evidence. The durable unit fixture expectations and this report preserve the concrete repaired cases and measured limitation.

## Final-source review and rerun

After root added displayed-formula handling and changed absent-cell style lookup to replace the previous matching style region, the independent agent reran all 35 actual command/engine comparisons and all four independent unit tests against current source. All remained passes. Review confirmed explicit formula text is escaped using the same byte writer, general formula alignment becomes left when formulas are displayed, and later matching metadata regions replace earlier regions while imported explicit cell styles retain precedence. No further validated regression was found in this coverage. This rerun uses TypeScript source through tsx rather than relying on previously built dist.
