# Database file codecs: procedure and verified coverage

## Reproduction procedure

1. Preserve the existing worktree and read root/scoped instructions. Authenticate
   `out/ssconvert-lifecycle/gnumeric-1.12.61.tar.xz` against
   `2ac135d856572713c1a408b76b50a59f2a9769ed21f1213446b5af255df20a12`.
   Inspect released `plugins/xbase/{boot.c,xbase.c,plugin.xml.in}` and
   `plugins/paradox/{paradox.c,px.h,plugin.xml.in}` only beneath `out`.
2. Use original small byte arrays and memfs in unit tests. Reproduce missing
   import/export support before implementing handlers in declarative providers.
   Use the actual engine, engine-owned workbooks, injected byte I/O and signals;
   no native spawning, LLM calls or host-file creation in unit tests.
3. Native QA is separate: use the existing `colima` container
   `ssconvert-statistics-qa`, binary
   `/out/ssconvert-statistics-oracle/prefix/bin/ssconvert`, with source/dependency
   identity from [the retained profile](../ssconvert/html-reference-profile.json).
   Create only task-owned fixtures and optional plugins beneath
   `out/ssconvert-database`; never install a native product fallback.
4. Capture binary, dependency, plugin, compiler and locale identities before
   optional Paradox comparisons. Use `LC_ALL=C`, `TZ=UTC`, initially isolated
   task HOME, `GSETTINGS_BACKEND=memory`, explicit prefix `LD_LIBRARY_PATH`,
   `GSETTINGS_SCHEMA_DIR`, `XDG_DATA_DIRS`, and task-only
   `GNUMERIC_PLUGIN_PATH`. Keep unpatched and modified dependency observations
   separate. An unusable oracle profile is not a product pass.
5. Compare statuses, channel bytes, worksheet values/styles, dimensions and
   namespace effects independently. Cover versions, field conversions, invalid
   encodings, deletion, missing memo data, index trailers, block counts and
   malformed specifications. Do not treat unsafe native allocator results as
   deterministic values or increase timeouts to hide cyclic-file hangs.
6. Have a different agent stress/fix the implementation after building it.
   Root owns provider/integration/Git work. See
   [independent QA](ssconvert-database-independent-qa.md).
7. Run the maintained uncached selected workspace build closure, package unit
   route and lint, then the actual Safe Bash command tests and integration-input
   controls. Capture and inspect the virtual-command listing and typed database
   round trip with the maintained screenshot command. Reduce observations into
   the coverage/profile record; purge only task-owned scratch afterward.

## Implementation and source audit

`packages/ssconvert` remains the TypeScript ESM implementation named ssconvert;
Safe Bash composes its existing virtual command and shared CLI/SDK engine. The
provider registry derives availability/listing/order from declarative handlers.
No provider-ID branches, native dependencies, native fallbacks or new runtime
dependencies were introduced. Existing edits and README files were preserved.

| Format | Implemented behavior | Audit limits |
| --- | --- | --- |
| DBF | Import-only; declared versions 02,03,30,43,63,83,8b,cb,f5,fb; unknown versions warn and continue | Versions interpreted with the released common layout, including its FoxBASE assumption; these cases are not a comprehensive third-party file corpus |
| DBF descriptors | Ten-byte names, sequential lengths rather than stored addresses; terminators 00/0d; invalid types and fields exceeding record length warn, retaining preceding fields | DBC metadata is not interpreted; no companion namespace effects |
| DBF records | Header/record offsets, deletion flag 2a, packed remaining rows; C,N,L,D,I,F,B conversion | Invalid binary lengths bounded instead of native unsafe reads; zero-record/truncated-record native allocator behavior remains unqualified |
| DBF text | Header codepage overrides text CLI encoding; strict captured converters; trailing ASCII whitespace removal; Latin-1 fallback; invalid bytes become '?' with warning | All 68 source language IDs measured on one original byte cohort; this is not every possible byte string |
| DBF dates/logicals | Valid dates become spreadsheet serials; 00000000 omitted; invalid dates remain strings; Y/T,N/F variants; blank/? omitted; invalid logical warns | Native sscanf accepts additional unusual syntax not exhaustively measured |
| DBF numerics | N native-style initial decimal conversion; I little-endian integer; F little-endian double; B int64-to-double with native FIXME warning | Binary field copy preserves measured NUL-padding quirk; hexadecimal, extreme/nonfinite N and unusual numeric locales remain unmeasured |
| DBF memo/other fields | M,?,G,P,Y,T become released unsupported-field text, including memo files with no companions | Memo content is not supported by released Gnumeric xBase importer; no invented DBF writer |
| Paradox input | Database and primary-index common/data headers; version IDs 3–15; field metadata, chained blocks, typed records; primary-index three signed trailers and block number | IDs13–15 retain pxlib's default old layout; types outside its table/index census, encryption and real third-party catalogs remain unqualified |
| Paradox fields | A,D,S,I,$,N,L,T,@,+,#, inline M; unsupported fields produce native text | B,F,O,G,Y imports remain unsupported text as in released importer; malformed dimensions use bounded refusal |
| Paradox output | Real binary nonindexed database, current sheet, first-row Name,Type,Size/precision specification; type aliases C/A, block sizing, typed nulls, CP1252 data, BCD precision and inline memo | Whole binary byte identity is not claimed: native writes pointer/time metadata and has unsafe short-specification parsing |
| Paradox companions | Gnumeric's GSF importer does not bind MB/PX companions; external memo warns/omits; exporter never creates an MB/PX file | External memo read/write content is not a claimed capability; oversized memo warns and retains the table/other fields |
| Workbook/save | Bold headers, per-value date/time/currency formats, imported sheet dimensions, active-sheet export and generic lifecycle I/O | Sparse leading-column save behavior, maximal dimensions and all default-format metadata are not fully measured |

## Native optional profiles

The reused primary binary SHA-256 is
`104f1e5500432c95ac3d46a679d476d05d2bf84e7483e991d212703cb0ed131c`.
This arm64 Debian trixie build initially lacks Paradox. It has libgsf1.14.53,
GLib2.84.4-3~deb13u5, GTK3.24.49-3 and GCC14.2.0-19. The retained base profile
records library/plugin identities; the [reduced database record](../ssconvert/database-file-codecs-verification.json) additionally
captures the actual 516-package census and explicit optional environment.

Primary pxlib sources were acquired only under `out`:

- Debian-pool pxlib0.6.8 archive SHA-256
  `d3649587536fc3fd7cc26e0b11e9235068a7fafc879492e1d6934985c782e99d`.
- Debian-pool pxlib0.6.9 archive SHA-256
  `ab1ac57ed55a7cf5c0f8dbe5c053088120e3adcbb1950bd36dc5d8995258fcaa`.

Unpatched pxlib0.6.8 and Debian pxlib0.6.9-1 both exposed GSF pointer truncation
on this 64-bit profile: valid JS databases failed to open. Enabling iconv in
source0.6.9 exposed its undeclared `res` variable in `PX_put_data_alpha`.
These are recorded oracle failures, not passing differential cases.

For a separate QA variant, change only `px_gsfread` to return requested ssize_t
length on a non-NULL read pointer and -1 otherwise, and compare iconv's result
with `(size_t)-1` without the undeclared assignment in `PX_put_data_alpha`.
Configure with `am_cv_func_iconv=yes`, `--with-gsf=yes`, a task-owned prefix and
`CFLAGS=-g -O2 -Wno-error=incompatible-pointer-types
-Wno-error=implicit-function-declaration`. Compile the unchanged released
Paradox plugin against those exact headers. This is explicitly a modified
optional dependency profile, not an unmodified Gnumeric/pxlib parity gate.

Variant libpx SHA-256:
`758aa7f70d40fe804b54792712a46d9f1d0be4df15de74270edada728334ae25`.
Variant plugin SHA-256:
`fc6fce627e6a6b97cf70895896e8111569d6d04e8c1dcf678d2ea92d88f4e8ff`.
Full raw optional-profile capture SHA-256 before reduction:
`c364e7a3959d7d980265b15756d11eae0e7b3688b40569f6e3e5dd255d840a51`.

## Verified observations and remaining mismatches

The 24 original field/version/index cases matched native CSV output after
test-first repairs for xBase binary copying and DBCS decoding. All 68 original
language-ID sampled cases matched output after test-first fallback repairs.
Codepages737/874 additionally captured every byte through libgsf's actual
converter; static mapping facts have no native runtime requirement. The raw
mapping capture SHA-256 is
`bf4aab6188b385ac21eb12e4ffc6145127e5541f079b0d217d32169cf79d3d6f`.
DBF missing memo companions had no reads/writes and produced the unsupported
M field string. Unknown version99 emitted the exact plain `unknown 0x99` notice.

The modified optional profile imported a JS-generated binary table successfully
with status0 and no diagnostics: CP1252 Café, -12.5, FALSE, -3, date43832,
time0.5, timestamp43832.5 and BCD12.34. JS also imported its native-generated
table, preserving the native BCD value bytes, not repairing them speculatively.
Primary-index signed trailers and block number matched output, including the
old-profile `Target encoding could not be set.` warning. Oversized block counts
retain the first readable record and emit the native count/header warning.

Remaining observable gaps:

- Released Paradox exporter frees rendered field specifications before using
  their type/size pointers. Short specifications produced varying unknown-type
  warnings and status0 empty outputs; longer original names permitted output.
  The JS implementation safely parses intended specifications. Native garbage
  types/empty output and allocator-derived BCD export corruption are not matched.
- Inline native memo reads allocate exactly the blob length without terminating
  a string. Both native-generated and JS-generated `small` values were exported
  as `small` plus replacement garbage. JS preserves exactly `small`; this is
  an explicit mismatch, not a passing memo differential.
- Missing/short native block data exposed uninitialized values, including
  -2147483648, with status0. Product reads are bounded and preserve partial
  headers/records with diagnostics; unsafe allocator output is not reproduced.
- Native cyclic database chains timed out at both10s and5s, after a count warning.
  Product termination/cancellation stays bounded and reports the repeated
  block. This is an intentional observable mismatch, not a native pass.
- Warning message ordering is tested. Native GLib process/PID/time prefixes and
  PX_MEMORY_DEBUGGING allocation totals are profile-specific; product semantic
  diagnostics do not fabricate those prefixes/totals.
- Native external-blob companions are unbound in this GSF path. Original missing
  companion behavior is source-audited; broad corrupted/associated-file corpora,
  encoding-loss/truncation boundaries, encrypted tables, maximal dimensions,
  sparse multi-sheet save semantics and non-C locales remain unmeasured.

## Checks and delivery

Fresh selected build: `npm run build:workspaces --
--workspace=@poe-platform/safe-bash --no-cache`, covering the maintained
dependency closure and postbuild stages. Package unit route:
`npm test --workspace=@poe-code/ssconvert -- --no-cache`:225 files,5182 tests
passed, including31 database cases after independent stress additions. Package
lint covers source and strict test types. Actual command cohort:
`node --import tsx --test packages/safe-bash/tests/commands/ssconvert*.test.ts`:
79 passed. Integration-input runner tests passed; exact new command-test input
is registered in the root-owned discovery assertion.

Guarded `npm run lint:eslint` completed with16905 linted files,0 errors and4
warnings. Its completed run preceded the final count/diagnostic additions;
package lint and focused command rechecks cover those later changes separately.
No full repository clean gate is claimed. `npm test`'s unit runner rejects a
workspace selector; the maintained package route was used instead.

The attempted Safe Bash `npm test` ignored `SAFE_BASH_TEST_RG` on its current
route and ran the unfiltered suite. It encountered the old exact ssconvert
listing assertion; that assertion was repaired and the79-command cohort passed.
The unrelated frozen TODO cases were not counted as passes. The unfiltered
owned run was stopped; no whole Safe Bash suite pass is claimed.

`npm run typecheck --workspace=@poe-platform/safe-bash` exits2 before compilation:
`Public SafeFS must preserve shared SafeJS runtime identity`, expected root
SafeFS export `./packages/safe-js/dist/safe-fs.js`, actual undefined. The checked
root manifest has no such export; this task did not change that manifest or
the SafeFS binding. The full maintained consumer gate remains blocked. Package
strict types/build and actual command tests are separate successful checks.

Screenshot procedure used `npm run screenshot -- --output
out/ssconvert-database/visual-final.png node --import tsx
out/ssconvert-database/visual.mjs`. Inspected the actual virtual importer listing
and database conversion/reimport: legible aligned columns, correct provider IDs,
CP1252 Café and typed -12.5, all three final invocations status0. Initial fd output
capture omitted its explicit exporter and correctly returned2; the corrected
capture supplies `-T Gnumeric_stf:stf_csv`. No screenshot tests were added.

No local commits, remote-main delivery, release, push or publication were made.
Task-owned scratch is purged after reduction; pre-existing source/oracle trees,
containers, unrelated files and edits remain untouched.
