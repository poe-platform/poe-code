# in2csv qualification

This change implements source dispatch and measured import behavior for the literal csvkit 2.2.0 executable, preserving its original parser and the fourteen-command safe-bash family. It does not qualify the entire command suite or every upstream importer case.

The frozen CPython 3.14.2 deployment in `reference-profile.json` supplied the original observations in `in2csv-reference.json`. Workbook samples use openpyxl reference generation and the csvkit source archive's dummy.xls. DBF samples are small descriptor/record fixtures constructed for reference measurement. Canonical regressions run solely on frozen in-memory text/bytes and memfs; no native tools or disk files are created by those tests. The independent agent's fourteen GeoJSON observations live in `in2csv-geojson-stress-reference.json` and exercise actual safe-bash execution.

Measured behavior includes format priority and extension boundaries, literal flag inventory/collisions, typed CSV and JSON/NDJSON inference, fixed schema conversion, GeoJSON nested properties and malformed feature/coordinate errors, DBF default inference/ignored options, XLS first sheet/XLSX active sheet, numeric-looking sheet names, names-only option applicability, ordered/deduplicated sheet exports, Unicode numeric selectors, stdout BOM/line numbers versus side-file output, stdin workbook caching, date/time/formula cells and automatic/explicit dimension reset. Effects checks compare exact stdout, stderr, status and side-file bytes. Additional regressions verify awaited stdout before exports, earlier file preservation after later failure, producer-buffer reuse, cancellation/cleanup enrollment and partial streamed side-file output.

The XLS/XLSX reader is JavaScript ESM `@e965/xlsx@0.20.3`, pinned in workspace/root runtime dependencies for packed consumers. It receives only owned byte arrays. XLSX ZIP payloads are checked with bounded office-package parsing before workbook parsing. Neither Python nor a native executable is a product path. No ODS/XLSB command, workbook writer, automatic network, database driver or interactive capability is added.

Outstanding compatibility blockers (not passes):

- DBF memo/extended fields outside C/N/F/L/D/I/B, case-insensitive filename discovery, unmeasured language drivers and malformed-record/date diagnostics. Unsupported types/driver bindings explicitly return status 78.
- Legacy non-Unicode BIFF encoding overrides outside the implemented mapping and unusual/encrypted/unsupported workbook structures. Parser failures remain status 78 unless specifically measured and mapped. Arbitrary valid workbook semantics, all BIFF revisions and every Excel style/calendar boundary are not qualified.
- Workbook parsing inside the JavaScript library is synchronous. The surrounding byte reads, ZIP validation, writes and cleanup are cooperative; there is no claim of preemption inside an opaque parser call.
- Frozen shared-engine quoting modes 2/4/5, locale/temporal expressions outside implemented profiles, unpaired JSON surrogates and warning/verbose-traceback deployment identity gaps remain explicit shared blockers.
- Non-Excel `--write-sheets -` decoding remains explicitly unqualified after its main stdout. Non-Excel comma selection follows the measured late closed-stdin/unbound-local failure.
- SDK filesystems exposing only bulk writeFile preserve measured successful export effects but cannot establish streamed partial-write/open-truncation semantics. Inject openWriteFile for those semantics; safe-bash binds it through its registered file-output descriptor path when the filesystem exposes open.
- General network/database/interactive suite compatibility and other command engines are outside this executable's qualification. Existing skipped/todo cases are not counted as successful compatibility measurements.
- README additions were not authorized; contract details are kept in docs/specs/in2csv.md.

Build/test/lint and visual validation outcomes are recorded after the final checks below.

Final validation (2026-09-18):

- Maintained uncached safe-bash build closure: `npm run build:workspaces -- --workspace=@poe-platform/safe-bash` passed, including csvkit and its declared dependency closure.
- `VITEST_MAX_WORKERS=1 npm run test --workspace @poe-code/csvkit`: 49 files passed; 2,697 tests passed, one skipped and six TODO. The seven incomplete cases remain blockers. The executable tests include 62 frozen original observations, SDK/parser checks and resource/budget regressions.
- Actual safe-bash ownership, independent in2csv stress and existing csvkit stress tests: 82 passed, zero skipped/TODO. The separate agent reproduced malformed GeoJSON and workbook effects; root fixed its reported stdout/sibling-file cleanup defect with an original failing VFS regression.
- `npm run lint --workspace @poe-code/csvkit` passed ESLint, product TypeScript and test TypeScript checks. `npm run typecheck --workspace @poe-platform/safe-bash` passed source/tests and 26 public-consumer groups, including expected negative-type assertions. An earlier overlapping build/typecheck attempt correctly rejected changed declaration identity; the sequential rerun passed. These are type checks, not runtime qualification for historical or held integrations.
- Final repository-wide `npm run lint` passed its maintained ESLint, TypeScript/contracts and workflow routes.
- Original failing regressions established false ZIP-size acceptance, sibling side-file truncation on stdout closure and empty-GeoJSON column-limit bypass before fixes. Final package/shell runs cover those fixes.
- Ad hoc screenshots of actual safe-bash conversion and the root CLI help were inspected. Conversion displayed line numbers, accented text and inferred values correctly. Screenshots are visual evidence only, not compatibility measurements.
- Full `npm test` did not pass. Attempts recorded codec timeouts in safe-python (UTF-7, EUC-JP, EUC-KR and Johab), and an earlier attempt recorded a docx timeout. An isolated EUC-JP plane-one case passed in 444 ms, while two-file reruns each recorded one timeout in different cases. Cause and full-repository acceptance remain unresolved; no timeout was waived or counted as a pass. A full run that captured the original failing ZIP regression was stopped after fixes; its result is not a post-fix acceptance run.
- No commit, push, publication, staging change or README addition was performed. Task-owned temporary reference scripts, logs and screenshots are purged after recording outcomes; frozen reference fixtures remain in docs/csvkit.
