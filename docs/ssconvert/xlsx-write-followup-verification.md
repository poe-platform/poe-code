# Current XLSX writer verification

This receipt qualifies the source hashes in `xlsx-write-followup-verification.json`, on Git base `b97c4938a469ee70e09bd08a0e5fcf7e868ca04c` with existing uncommitted work preserved. It is not a committed revision or remote delivery. No README edits, commits, pushes or publication were performed. The manual procedure is `docs/plans/ssconvert-xlsx-write-followup-qa.md`.

Both existing stable exporter IDs remain separate: `Gnumeric_Excel:xlsx` uses the 2006 profile and `Gnumeric_Excel:xlsx2` the 2008 profile. Profile-specific borders/web publishing, default resolution and the shared SDK/virtual-command engine are covered by current tests. Native default `.xlsx` export selects the second profile. Both reject sheet selection with status 1 and exactly `Selected exporter (Gnumeric_Excel:ID) does not have the ability to export a subset of sheets.` followed by newline, without creating an artifact.

Before repairs, original in-memory tests failed for missing trailing row metadata/dimensions, imported axis loss diagnostics, automatic sizes marked as explicit sizes, missing maximum outline levels and malformed cell coordinates. Native-generated fixtures independently established axis/merge behavior. Repairs preserve later row/column extents, row visibility/collapse/outline settings, native merge attributes, imported HardSize settings and per-sheet outline maxima. Cell coordinates now require safe integers within writer limits.

A different agent independently stressed/fixed the writer and added negative controls. Coverage includes empty/axis-only sheets, the final XFD1048576 address, numeric-zero/false/error formula caches, cancellation with falsey reason identity before workbook access, input-order preservation, repeated ZIP determinism, explicit/automatic imported sizes and separate row/column/sheet outline maxima. Warning suppression applies only to converted Gnumeric axis records; unconverted and foreign records still warn. These tests use in-memory data; command file-effect tests use memfs. Unit tests do not spawn native tools or write fixtures to disk.

## Final gates

| Check | Result |
| --- | --- |
| `npm test --workspace=@poe-code/ssconvert -- --no-cache` | 153 files; 4,151 passed, zero failures/skips/TODOs |
| `npm run lint --workspace=@poe-code/ssconvert` | Passed: ESLint, source TypeScript, test TypeScript |
| `npm run build:workspaces -- --workspace=@poe-platform/safe-bash --no-cache` | Passed: maintained 18-workspace closure including suffix stages |
| Node/tsx command tests: ssconvert, ssconvert-text, ssconvert-encoding | 51 passed, zero failed/skipped/cancelled/TODOs; actual shell/SDK/namespace/checkpoint/replay cases |
| Independent final outline controls | 14 follow-up tests passed; included in final package gate |
| Native/openpyxl final reopen | Four artifacts passed measured axis/value/merge checks; native status 0 and empty diagnostics |
| SDK fixed-clock repeated exports | Four fixtures/profile cells produced identical bytes on repeat |
| CLI screenshot | Actual virtual-command conversions rendered and visually inspected; both status 0, empty diagnostics |

An intermediate closure failed its compiler-input identity guard (`mtimeMs`) while another closure rebuilt its inputs. It was not counted as a pass. The complete final closure was rerun with stable inputs and passed. Earlier successful gates invalidated by later changes are not substituted for the final gates. There were no final incomplete or failing maintained runs. Repository-wide `npm test`, root lint/build, full safe-bash units, new cross-realm/host qualification and performance measurements were not run; these focused writer changes do not alter the authority boundary. Existing integration cases cover original/checkpoint/replay, but do not establish complete realm/host coverage.

## Native differential evidence and remaining mismatches

The official archive SHA-256 matches `2ac135d856572713c1a408b76b50a59f2a9769ed21f1213446b5af255df20a12`. Six extracted writer/plugin/extent source files were reauthenticated against the archive, all under `out`. The separate Docker `colima` oracle reports 1.12.61; its executable hash matches the prior profile. Current environment, locale, exporter listing, dynamic dependency paths and 72 dependency hashes are retained in the reduced JSON receipt. Openpyxl 3.1.5 was installed only into an isolated QA environment under owned `out` scratch, then removed.

Original fixtures have populated A1 or no cells, hidden column E, hidden/collapsed/outlined row 9 and, for the populated case, merge A3:B4. All four exports have native's nine ordered OPC members. All populated-case worksheet records and ordered XML structures match native; `docProps/core.xml` differs because native injects a default creation timestamp when the input omits one. Axis-only worksheets additionally differ in native's split of default columns A versus B:D; candidate combines A:D. This structural mismatch remains recorded rather than normalized away. Native/openpyxl preserve the measured axis semantics.

Comparison retains attribute/child/member order, relationships and leaf text; only element-only indentation is omitted. Raw XML differs in all nine parts, and ZIP bytes differ. The receipt retains ZIP flags, creator versions, timestamps and extras separately. Candidate fixed-clock determinism does not imply native byte identity. Openpyxl reports the native-compatible missing default-style warning.

The full prior handler audit in `xlsx-write-verification.md` remains applicable as a limitation inventory, not fresh verification of all its earlier native cases. Drawings/charts/images beyond comment VML, pivots and their edition switch, row styles, rich comment geometry, advanced styles/conditional formatting/print behavior, full string-interning fidelity, out-of-range native truncation diagnostics and complete extension/loss-warning parity remain unsupported or unmeasured. Current extreme-address/cache controls are unit checks; native extreme limits and all locale/plugin variants are unverified. Full semantic and byte parity with Gnumeric 1.12.61 remains incomplete.
