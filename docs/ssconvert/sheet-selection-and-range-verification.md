# Sheet selection and range verification

See the [exact-candidate follow-up](sheet-span-followup-verification.md) for the
subsequent unequal-dimension sheet-span fix, independent holdouts and fresh gates.

Implemented the shared TypeScript ESM `ssconvert` engine's common selection and
hidden export-range semantics, with Safe Bash exercising that same engine.
The separate [native profile](sheet-selection-and-range-profile.json) records
169 native observations, one unmeasured NUL-argv case, original fixtures,
dependency versions, binary/library identities, activation results and both
`C` and `C.UTF-8` locale observations. This is scoped evidence, not complete
Gnumeric compatibility or qualification of every exporter.

## Reference and primary evidence

The unchanged Gnumeric 1.12.61 archive was authenticated against
`2ac135d856572713c1a408b76b50a59f2a9769ed21f1213446b5af255df20a12`.
GOffice 0.10.61 archive SHA-256 is
`558597fd9ca59b93ff562750218d1e7ea8ec3c8d0ed6a5cc096aa715ef909a15`.
The fresh QA-only binary SHA-256 is
`d7b57fbb10a99097326d381f6e8c6ab9150092fca78cd03d7f41e5c968d64e82`.
The isolated Debian image digest is
`sha256:a99cfc517144bc59b1978475ec53b46ecabec7e43635402ee5b77cc54cd1b20a`.
Only task-owned evidence was mounted; the repository and host HOME were not.
This captured dependency snapshot supplements the existing reference profile;
it does not replace its outstanding optional-format qualification gates.

Primary source was acquired only into `out`. Source contracts and hashes are
recorded for `src/ssconvert.c` (setup_range 252, option handling 290, validation
328, split saving 1165, updates 1241, final selection 1472), `src/gutils.c`
(single/multiple sheet access 981/1017, common options 1064, range evaluation
1241), `src/parse-util.c` (columns 156, rows 237, workbook/sheet references
969/1021, A1 ranges 1180), `src/position.c` (relative wrapping 528),
`src/stf-export.c` (range consumption 291) and the relevant exporter sources.
Unicode classification uses generated Unicode 16.0.0 category data from the
authenticated GLib 2.84.4 header, not the host's changing Unicode tables.

## Verified behavior

| Area                          | Verified result                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Common options                | Mandatory equals; empty/false/arbitrary active-sheet values ignored; case-folded sheet names; exact unknown-name diagnostic; ordered duplicates retained.                                                                                                                                                                                                                                                                           |
| Defaults                      | Sheet/range writers default to the active view; workbook writers default to all sheets; absent active view falls back to the first sheet.                                                                                                                                                                                                                                                                                           |
| Capabilities                  | Workbook exporters without sheet-selection reject subsets and splitting; range exporters reject splitting; sheet exporters require one selected sheet outside split mode, counting duplicates. Validation precedes range processing.                                                                                                                                                                                                |
| Exporter consumption          | Text and PDF receive range metadata; LaTeX uses runtime selection and range metadata. HTML uses selection while ignoring the range coordinates. XML/TROFF ignore internal range selection; SYLK/DIF use the active view even with common sheet selection. No provider-ID dispatch branches were added.                                                                                                                              |
| Range grammar                 | A1 cells/rectangles, absolute and relative endpoints, whole rows/columns, reversed coordinate endpoints, separately quoted sheet spans, single/double quotes, backslash escaping, bare-name restrictions, strict trailing-text rejection. Named expressions are rejected in these paths, matching native setup_range/apply_updates. Doubled apostrophes are rejected.                                                               |
| Sheet spans                   | Original sheet endpoint order retained; reverse sheet spans parse but select no CSV data. Per-sheet evaluation binds returned coordinates to the actual target sheet.                                                                                                                                                                                                                                                               |
| Range selection               | Nonsplit ranges override earlier selection after capability validation. Split selection order and duplicates remain; qualified ranges exclude other sheets, while unqualified references evaluate on each split sheet.                                                                                                                                                                                                              |
| Relative coordinates          | Unqualified relative endpoints wrap on smaller target sheets; absolute endpoints remain fixed. Mixed and reversed endpoint flags stay paired through normalization. Whole-axis bounds retain the parser's first/endpoint sheet dimensions.                                                                                                                                                                                          |
| Workbook qualifiers           | Current loaded input identity resolves relative/absolute filenames, exact file URIs and quoted filenames. Explicit stream identity resolves fd://0. Unregistered names and anonymous streams trigger no ambient lookup.                                                                                                                                                                                                             |
| Set                           | Shared range prefix parser finds equals after quoted names; remaining equals belong to cell text. Qualified references determine normalized coordinates, then the native update path writes through the active view. Whole axes and spans are accepted. Unqualified relative coordinates wrap before coordinate normalization.                                                                                                      |
| Merge                         | Common options and split capability validation run against the fresh empty target before input reads/merging. Sheet/active-sheet selections fail there with native ordering.                                                                                                                                                                                                                                                        |
| Hidden/sparse/merged fixtures | Native roundtrip confirms hidden row/column and A1:C2 merge metadata. CSV includes hidden cells; default extent ignores empty-valued/styled trailing blanks and merge-only extents, while an empty string extends it. Explicit A1:E5 exports requested trailing blanks. Empty/merge-only sheets default to one empty CSV row. These are reference/fixture-serializer observations, not installed native-format codec qualification. |
| Ownership and isolation       | Selection/range metadata is owned; workbook records are not pruned. Existing cancellation/cleanup/storage suites remain green. Unit file effects use memfs; no unit test invokes native utilities, queries an LLM or writes host files.                                                                                                                                                                                             |

The QA differential driver used an independent small bounded injected fixture
reader/writer with the real SDK command engine and memfs. All 77 ASCII command
cases matched exit status, stdout/stderr bytes, output names/content and
selection order. Six non-ASCII C-locale argument cases were excluded explicitly
from that product comparison; their native results are retained. File modes
were captured natively but are not qualified by this memfs comparison.

A different agent stress-tested and repaired the implementation after the
initial implementation, adding 11 independent unit cases and capturing 15
additional native observations. Every repaired discrepancy had a failing
regression first. Root retained public export, Safe Bash integration and Git
ownership. The exported `exportRangeForSheet` returns the coordinates a
range-honoring writer must consume, including per-sheet relative normalization.

## Checks

- `npm run build:workspaces -- --workspace=@poe-platform/safe-bash --no-cache`:
  passed the maintained selected dependency closure, 18 builds including
  ssconvert, Safe Bash and its native npm postbuild stage.
- `npm run test --workspace=@poe-code/ssconvert -- --no-cache`: 520 tests in
  37 files passed, including ownership, resource, cancellation and parser suites.
- `npm run lint --workspace=@poe-code/ssconvert`: passed ESLint and production/test
  TypeScript checks; no cache requested or used.
- `TSX_DISABLE_CACHE=1 node --import tsx --test
packages/safe-bash/tests/commands/ssconvert.test.ts`: 22 integration cases passed
  against the final built SDK, including qualified whole columns, ordered
  duplicate splitting, empty excluded outputs and exact invalid-range diagnostics.
- The changed Safe Bash test file passed scoped ESLint from the Safe Bash
  workspace. An actual virtual-command screenshot was inspected for unknown
  names, duplicate selection, trailing text and a successful quoted column range.
- `npm run typecheck --workspace=@poe-platform/safe-bash` failed before source or
  consumer compilation: its public SafeFS prerequisite expects
  `poe-code/safe-fs -> ./packages/safe-js/dist/safe-fs.js`, but the current root
  manifest does not export that entry. This is a failed gate, not a pass. The
  unrelated root export surface was preserved; the selected workspace build
  compiled the changed command/SDK declarations. Full Safe Bash typecheck and
  repository-wide gates are not claimed.

## Remaining mismatches and unmeasured coverage

- The native grammar accepts the error-sheet literal `First!#REF!`. The measured
  CSV oracle exits 1 with GLib critical messages containing PID/time and a CSV
  write-error diagnostic. The implementation rejects it earlier with
  `Invalid range specified.` This is a known diagnostic/stage mismatch; that
  native result is retained and is not a product pass. Other exporter effects
  for this literal remain unmeasured.
- The native `C` locale rejects non-ASCII option argv during conversion to UTF-8;
  JavaScript string arguments already occupy a Unicode domain. C-locale byte
  transcoding parity is not established by this work. UTF-8 native probes confirm
  quoted numeric-symbol and bare Japanese sheet-name grammar separately.
- Other simultaneously loaded workbooks lack an engine-local reference namespace.
  Current-input qualification is supported; ambient/global workbook lookup and
  host filesystem fallback are not introduced. Cross-workbook references after
  multiple independent reads or during merge are not qualified.
- Custom `Codec.exportOptions` callbacks retain ownership of their option grammar
  and native common-option dispatch, matching the source's alternate handler
  path. The declarative common-option route is verified here; arbitrary injected
  callbacks are not automatically native-conforming.
- Native-format readers/writers remain explicitly injected capabilities. This
  task does not install full CSV/HTML/LaTeX/PDF/SYLK/DIF/XML serializers or qualify
  their complete bytes, formatting, visibility/rendering behavior, print areas,
  floating objects, every sheet size, or optional plugins. Renderers must consume
  the returned normalized range; merely testing that a range exists is insufficient.
- NUL cannot be passed as a native process argv character; that differential is
  unmeasured. SDK/parser C-string termination is covered independently by units.
  Native modes, symlink/permission behavior and exhaustive replay/environment
  profiles were not newly qualified by the scoped differential cohort.

Owned source extraction, logs, acquisition drivers and screenshots are removed
only after reducing observations and check receipts into the profile. The owned
oracle container is removed. Existing unrelated `out` evidence is preserved.
README files are untouched. No commits, push, release or publication were made.
