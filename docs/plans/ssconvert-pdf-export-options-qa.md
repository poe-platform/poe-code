# PDF export options implementation and QA

Status: partial implementation; **pdf-export-options is not complete**. This is a
live, dirty-worktree verification, not a frozen candidate or a release gate.
Root owns exports, integration and Git. No README edits, commits, pushes or
publication were performed. Preserve inherited edits and oracle containers.

## Procedure

Execute these steps as an agent, never as a product command or unit test.

1. Authenticate the official Gnumeric 1.12.61 source archive against
   `2ac135d856572713c1a408b76b50a59f2a9769ed21f1213446b5af255df20a12`.
   Acquire/extract primary sources only in `out`. Inspect `src/print-info.c`
   PDF option callbacks and `src/print.c` object printing. Inspect public PDF
   writer and bounded decoder capabilities before wiring the implementation.
2. Use original in-memory fixtures and memfs for command file effects. First
   demonstrate absent PDF writer with failing regression tests. Do not spawn
   native utilities, write files or query LLMs from unit tests.
3. Use the explicitly separate native oracle via Docker context `colima`.
   Capture command argv, statuses and stderr/stdout independently. Configure
   schema discovery, memory settings backend, C locale, UTC and owned HOME/XDG
   directories explicitly. Capture dependency/plugin/locale profile separately.
4. Compare native/product PDF page count, dimensions, extracted content,
   drawings, fonts, images and rendered pixels. Inspect actual page screenshots.
   Independently compare raw PDF and metadata bytes; prove nondeterminism with
   repeated native executions. Do not normalize typography, pagination, lost
   content, deterministic metadata or unsupported objects.
5. Have a different agent stress/fix current code with failing tests. Root
   retains export/configuration/integration/Git ownership. Repeat affected
   checks after subsequent repairs and obtain independent review.
6. Run maintained selected uncached workspace build closures, ssconvert/PDF
   package unit/lint checks and actual Safe Bash command/SDK/replay integration.
   Record remaining mismatches explicitly. Keep temporary captures in `out`
   and purge owned scratch after reducing evidence; keep unfinished-gate
   captures available until their audit is reduced.

## Captured oracle profile

Verified September 21, 2026. The archive already acquired under
`out/ssconvert-lifecycle` was rehashed successfully; primary source was not
copied into product code. Native executable reports Gnumeric 1.12.61.

- Container: inherited `ssconvert-statistics-qa`; Docker context `colima`.
- Image: `sha256:a99cfc517144bc59b1978475ec53b46ecabec7e43635402ee5b77cc54cd1b20a`
  (`debian:trixie-slim`, arm64).
- Prefix: `/out/ssconvert-statistics-oracle/prefix`.
- Executable SHA-256:
  `104f1e5500432c95ac3d46a679d476d05d2bf84e7483e991d212703cb0ed131c`.
- Locale/timezone: `LC_ALL=C`, `LANG=C`, `TZ=UTC`.
- `GSETTINGS_BACKEND=memory`, explicit prefix schema directory and
  `LD_LIBRARY_PATH`; HOME/XDG roots under `/out/ssconvert-pdf-qa`.
- Fresh dependency snapshot, `ldd` output, all 47 installed plugin manifests
  and their hashes, environment, argv, statuses and byte diagnostics captured
  in `out/ssconvert-pdf/native/profile.json`. Installation is not proof that
  every plugin was activated/exercised.

| Captured dependency | Version |
| --- | --- |
| GTK | 3.24.49-3 |
| GLib | 2.84.4-3~deb13u5 |
| Cairo | 1.18.4-1+b1 |
| Pango | 1.56.3-1 |
| Fontconfig | 2.15.0-2.3 |
| FreeType | 2.13.3+dfsg-1+deb13u1 |
| HarfBuzz | 10.2.0-1+deb13u1 |
| DejaVu fonts | 2.37-8 |
| glibc | 2.41-12+deb13u4 |

Initial native probes omitted schema discovery and produced GOConf warnings.
They are invalid comparison-profile evidence. Fresh configured probes had no
such warnings; the unknown-paper GTK warning below remains observable.

## Verified behavior and repairs

The provider installs `Gnumeric_pdf:pdf_assistant` automatically through the
existing registry. Safe Bash's existing `ssconvert` binding uses the same SDK
engine with injected byte I/O and cancellation; no native dependency/fallback
was introduced. The workbook writer consumes existing print pagination and
header/footer engines; supported graph root paint uses the existing graph scene
projection. This does not establish complete chart-scene rendering.

- Absent-writer regression failed before implementation; now passes.
- Source `print-info.c` collects every matching object for each `object=` in
  option order, sheet order and reverse insertion order. `print.c`'s
  `gnm_print_so` explicitly prints only the first collected object. Native
  repeated-name and repeated-option outputs verified one page, not many pages.
- Original graphs named `same`, widths 71 then 123, height 35: native/product
  `object=same paper=fit` and repeated `object=same` both produce a single
  123-by-35-point page. Geometry, extracted content and rendered pixels match.
- Named object takes precedence over sheet selection. `paper=fit` only changes
  the graph path; fit remains sticky through later paper options, as in source.
- A solid red first graph on normal A4 has native/product drawing rectangle
  `[72,72,195,107]`. The incorrect guessed 28.346-point origin was reproduced
  by native differential comparison and a failing regression before repair.
  Rendered 2x-resolution pixel SHA-256 matches:
  `e05b553ed668d450aedf9b5b836f2c8ab1e8c081cbc545c0fcc0c42a34fecff9`.
- Missing object: native status 1, exact stderr
  `ssconvert: There is no object with name 'missing'\n`; Safe Bash verifies
  matching status/diagnostic and absence of a created destination.
- Native `paper=A4`/`paper=iso_a4` succeed. Other implemented aliases are
  source-backed, not separately native-qualified passes.
- Original 90-row sheets One and Two: four native/product A4 pages; rows
  0–46 then 47–89 on each sheet; exact per-page extracted text including
  headers and cumulative `Page 1` through `Page 4` matches. Native default
  body margins are 120 points top/bottom, 72 points left/right. Incorrect
  guessed margins and restarting footer numbers had failing regressions
  before repair. One-sheet selection produces two pages.
- Independent agent reproduced/fixed propagation of row/column-zero size
  overrides into unspecified axes; image Content namespace; image-only
  workbook admission; declared raster geometry before parsing; cancellation;
  output admission; deterministic font bytes and transparent image masks.
- Root malformed-PNG regression reproduced a raw parser RangeError. Bounded
  public PNG decoding now rejects excess inflated scanlines as resource-limit
  before retaining an unbounded image. Original generated PNG fixtures replace
  the earlier fixture with an invalid CRC. RGB and alpha-mask bytes are checked
  independently. Intrinsic-pixel/object-print-dimension confusion also had a
  failing regression before repair.
- Actual Safe Bash VFS output, fd://1 replay and SDK stream output have identical
  PDF bytes; input/other files are preserved; missing-object failure creates
  no destination. Unit fixtures use memfs, never host files/native processes.
- A different agent reviewed subsequent bounded-PNG, 72-point-origin and
  cumulative-numbering repairs; no additional validated defect was identified.

## Independent metadata audit

Native empty-graph PDF producer is
`cairo 1.18.4 (https://cairographics.org)`; product producer is
`ssconvert JavaScript PDF writer`. This is a deterministic mismatch, not a
field eligible for nondeterminism normalization.

Native creation date changed from `D:20260921065657Z` to
`D:20260921070210Z` on repeated invocation. Product omits creation date. The
native date is proven nondeterministic, but this audit applied **no raw-byte
normalization**. Raw PDFs are not equal. Product repeated exports, including
non-ASCII font subsets and transparent images, are byte deterministic under
fixed inputs. This does not prove Cairo object/resource ordering, compression,
font subsets, ToUnicode maps, image encoding or native metadata-byte parity.

## Remaining mismatches and unmeasured gates

These are not passes and prevent task completion.

| Area | Current limitation |
| --- | --- |
| Typography | Product ships JetBrains Mono; native uses DejaVu Sans. Native sample body is 7.5pt with cell inset; product body is 10pt at cell origin. Cell text bounding boxes, font metrics, spacing, baselines and header/footer geometry differ. Workbook pixels do not match despite matching page text/boundaries. |
| Print settings | Persisted PrintInformation is explicitly unsupported. Paper/orientation/custom margins, scale/fit, repeat titles, breaks, copies, headers, print areas/names, do_not_print and error/comment policies are not integrated into the writer. Pure helper coverage is not PDF export coverage. |
| Cell painting | Styled/merged/rich-text cells are explicitly unsupported. Numeric alignment, multiline text, clipping/overflow, conditional styles, formula-display painting, grid/headings and complex-script shaping are unqualified. General formatting relies on injected formatting capability. |
| Charts and objects | Only supported graph root backgrounds and raster images are painted. Populated charts, shapes, controls, comments, components and unsupported scenes fail explicitly. Full chart layout/painter integration remains missing. |
| Object placement | Objects spanning pages and negative/mirrored workbook placements are unsupported. Cell-relative hidden-axis object placement is explicitly unsupported. Cropping, transformations, z-order overlap, graph size clamps, zero/negative graph dimensions and reversed direction remain unmeasured. |
| Named paper | Limited source aliases/canonical names implemented. GTK complete catalog/custom-size grammar is unqualified. Native `paper=garbage` emits a GTK warning and succeeds with fallback; product rejects this profile as unsupported with status 1. Warning pid/time bytes and per-sheet ordering are not matched. |
| Raster profile | Restricted static noninterlaced 8-bit PNG path; native broader PNG/interlace/bit-depth/animation/type behavior is unqualified. JPEG preflight/embedding exists, but native CMYK/ICC/malformed-marker diagnostics and rendered parity are unmeasured. Wrong CRC/unsupported PNG diagnostics differ from native tolerance. |
| Selection/lifecycle | Default/explicit/basic active-sheet behavior has unit coverage. Full duplicate names across sheets, Unicode name corpus, per-sheet/template combinations, empty/style-only/hidden-only workbooks and retained namespace side effects remain unmeasured natively. |
| Metadata/structure | Native producer/date representation, resource ordering, PDF syntax, font/image subset bytes and compression remain different or unmeasured. No unrelated deterministic field was normalized away. |
| Budgets/integration | Bounded final serialization and PNG scanline inflation are verified; all peak-memory/CPU behavior of font parsing and JPEG embedding is not independently qualified. No new realm/replay/host authority is claimed. Packed standalone root/Safe Bash consumer closure is not yet qualified specifically for the new PDF dependencies. |
| Optional profiles | No complete optional dependency/plugin/locale/font matrix or full repository/release gate was exercised. |

## Local verification

- Final maintained uncached ssconvert package suite: 269 files, 5,676 tests
  passed after the transparent-image/origin/numbering repairs.
- Final focused PDF suite: 25 tests passed; independent agent reran all 25.
- Maintained uncached PDF package suite: 49 tests passed; PDF lint/typecheck passed.
- ssconvert lint includes ESLint, product and test TypeScript checks; final route
  passed. Earlier failed checks and failing regressions remain in owned scratch.
- Maintained uncached ssconvert and final Safe Bash build closures passed
  (4 and 18 builds respectively, observed from their maintained receipts). Task membership came from maintained
  workspace declarations, never from a fixed task-count shortcut.
- Actual Safe Bash PDF integration: one compound command/SDK/replay/namespace
  test passed. This is not the full Safe Bash test gate or repository lint gate.
- Rendered final native/product pages inspected visually; workbook typography
  mismatch retained. Rendered graph pixel match does not certify other scenes.
- Git diff whitespace check passed for tracked edits. No Git staging/delivery
  or release action occurred; local commits, remote-main delivery and releases
  are all absent for this task.

## Verified implementation identities

SHA-256 at final local verification (not Git commit identities):

- `packages/ssconvert/src/codecs/pdf.ts`: `998e18ff945325c87e6d4f24f693e2bd8181c01d443c0db9f880a9a538d4fadb`
- `packages/ssconvert/src/codecs/pdf.test.ts`: `5a48884eb7fa7149512ae148ea5e614c9c0c50ed14f631ceb44a03323df22c64`
- `packages/ssconvert/src/codecs/pdf-independent.test.ts`: `288ac1abc9a22661088d07f1c421d3bd6dfb0cff0eb97ad7714d300c4d48c795`
- `packages/ssconvert/src/codecs/providers/pdf.ts`: `1d8ba5b6ec91f6c61a0d6ec973194dbe472313925a178051646818774e535d15`
- `packages/pdf/src/index.ts`: `44dbe299d6dc3414a028adc4618054252bc260aeff3b6579a65036ed5feb7890`
- `packages/safe-bash/tests/commands/ssconvert-pdf.test.ts`: `0993e75bca98cc74b1cf5b52b661d11d401810114c684bff3f10c28d40de6d80`

Automatic approval review rejected removing scratch logs and the temporary QA
environment because they may contain useful evidence/dependencies. Cleanup was
not retried; all owned captures and the environment remain under `out/ssconvert-pdf`.
