# Listing and diagnostics verification

Task: `listing-and-diagnostics`. This report qualifies output behavior against
unchanged Gnumeric 1.12.61 and the captured C/UTC primary profile. It does not
claim complete spreadsheet-format, transform or native-platform parity.
The manual procedure is
[the listing/diagnostics QA plan](../plans/ssconvert-listing-and-diagnostics-qa.md).

## Reference and validated repairs

Primary source was downloaded/extracted only into owned `out` scratch. Its
SHA-256 matched
`2ac135d856572713c1a408b76b50a59f2a9769ed21f1213446b5af255df20a12`.
GOffice 0.10.61 matched
`558597fd9ca59b93ff562750218d1e7ea8ec3c8d0ed6a5cc096aa715ef909a15`.
Dependency identities, plugin activation, environment and incomplete optional
qualification are retained in `reference-profile.json`; that profile was not
rewritten. No native ssconvert runtime was started for this task. Native captures are an
explicit separate QA oracle, not product code or a fallback.

Source contracts inspected include Gnumeric `src/ssconvert.c:252–269`
(range diagnostics), `:290–378` (export options/subset/split), `:383–463`
(listing sorting/width/channel and image enum), `:468–499` and `:657–686`
(merge loading and unconditional notices), `:1237–1284` (update errors),
`:1289–1517` (selection/loading/status/verbose order); `src/workbook-view.c`
`:1195–1217`, `:1465–1498`, `:1539–1553` (loading/publication diagnostics);
`src/workbook.c:433–459`, `:1350–1397` (duplicate-sheet names); GOffice
`goffice/utils/go-glib-extras.c:289–315`, `:1227–1314` (quoting/key/value
syntax), `goffice/utils/go-file.c:521–541` (resource URI identity), and
`goffice/app/error-info.c:220–243` (warning/error prefixes).

Concrete failures were executed before repairs. The first seven regressions
produced six failures: image listing, UTF-8 ID ordering, verbose selection,
fd stdout routing, warning delivery and simulated output failure. Eleven
additional error-stage cases failed before their repairs. Subsequent failures
validated merge dispatch, stderr retry removal, URI diagnostics, diagnostic
retention budgets, file-publication URI wording and actual shared-engine merge.
The independent agent reproduced two export-option BOM failures and repaired
U+FEFF whitespace handling. Independent merge stress then reproduced five native source-contract naming
failures and repaired first/empty/numeric/uint32 suffix handling. Final stress
reproduced SDK cancellation being replaced by invalid decoded-model validation;
a cancellation check before retention repaired it. A root regression also
reproduced aggregate cell admission occurring after later inputs had loaded;
remaining storage limits now apply before each subsequent owned snapshot.
A final relative-loading regression validated virtual cwd diagnostics; seven
independent cases cover relative/parent/absolute paths, file/non-file URIs,
unchanged capability resource names and opaque exception identity.

Listings exclude interactive services, compare encoded UTF-8 bytes without
locale collation, use maximum ID byte length and write only stderr. Image
formats follow the reference enum. Version writes only stdout. CLI operation
results preserve status and raw diagnostic bytes; awaited streaming diagnostics
preserve warnings preceding failure and avoid duplicate callback/result entries.
Verbose inferred exporter selection precedes importer errors and is absent for
explicit exporter selection. Known filesystem errnos have operation-specific
wording; opaque host exceptions escape and typed statuses remain unchanged.
Diagnostic bytes are admitted before copies and bounded cumulatively. Cancellation
and cleanup remain invocation-owned. The virtual adapter supplies its explicit
virtual cwd and uses the same engine; fd stdout creates no VFS file.

SDK requests expose the same verbose and raw update/range/goal expressions as
the CLI. The optional awaited operation diagnostic callback delivers notices
before a later failure; successful results retain the same diagnostic objects.
This keeps callback/result delivery distinguishable without decoding raw bytes.

## Verified coverage

| Check                              | Verified result                                                                                                                                                 |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Authenticated captured `--version` | Status 0; stdout 147 bytes; stderr empty; exact capture bytes/hash                                                                                              |
| Captured `--list-importers`        | Status 0; stderr 1227 bytes; stdout empty; exact 19-ID capture                                                                                                  |
| Captured `--list-exporters`        | Status 0; stderr 1709 bytes; stdout empty; exact 26-ID capture                                                                                                  |
| Captured `--list-image-formats`    | Status 0; stderr 261 bytes; stdout empty; exact enum-order capture                                                                                              |
| Listing activation fixture         | Oracle IDs activate original mock codecs; source metadata supplies descriptions; this does not verify conversions                                               |
| Independent diagnostic stress      | 47 tests passed; diagnostic stages, quoting/BOM, sink/cancellation identity, owned bytes, budgets, merge suffixes/dimensions, storage admission and virtual cwd |
| Package tests                      | 287 tests passed in 20 files; maintained package test route, no result-cache skips                                                                              |
| Selected uncached workspace build  | Passed: exact @poe-code/ssconvert build closure with --no-cache                                                                                                 |
| Package lint/type checks           | Passed: maintained package lint, production and test type checks                                                                                                |
| Actual virtual Shell integration   | 16 tests passed; real Shell CSV-shaped/binary stdout, warnings, image/invalid expressions, actual merge notices/names and relative loading diagnostics          |
| Repository uncached test route     | Passed: `npm test -- --no-cache`, exit 0 including root posttest; declaration-derived 85-workspace inventory, 33 build tasks and 53 test tasks                  |
| Repository lint route              | Passed: maintained repository ESLint, root/type-consumer checks and actionlint                                                                                  |
| Ad hoc built-command screenshot    | Captured and inspected: aligned image columns, readable inferred exporter and invalid-range/status text                                                         |

The inspected screenshot SHA-256 was
`d7ba0605d791368d21c3a96c9b3a1130d457cbf763aa5fddabd2aa39f19b7a34`.
This screenshot is display evidence, not proof of stdout/stderr separation;
byte-channel tests verify separation independently.

Within the repository route, safe-bash reported 44,064 passed, zero failures,
831 skipped and two TODO cases; its runner checks separately reported 558
passed with no skips or TODOs. The two safe-bash TODOs concern CSV numeric/null
serialization and unavailable XLSX named shell descriptor paths. Skips, TODOs,
missing comparator installations and incomplete optional/native profiles are
not verified passes or evidence of ssconvert compatibility.
Other Vitest cohorts reported two skipped cases and five TODOs; SafeJS reported
31,121 passed and 48 skipped. The runner reported 33 workspaces with
`NO_DECLARED_TEST_NOT_A_PASS`, no excluded tasks, and two manifestless roots
(`packages/braintrust`, `packages/safe-bash-optional`). An uncached route exit 0
qualifies the maintained declared tasks, not these unavailable or skipped cases.

## Remaining mismatches and unmeasured cases

- No fresh native invocation or conversion differential was run. Only the four
  existing authenticated listing/version captures were compared byte-for-byte.
  Error-stage qualification otherwise uses source contracts and original fixtures.
- Actual basic merges support plain sheets and unconditional notices. Rich
  named/dependent/detached/formula/view/property/unsupported records and merge
  transforms are explicitly unsupported; complete native reference/name conflict,
  metadata and numerical semantics are not passes. Empty-input/native save and
  native merge differential remain unmeasured. The default dimension floor and
  uint32 name-wrap rules have source-grounded unit coverage, not native execution.
- Valid raw update, export-range and goal-seek expressions remain unsupported.
  Invalid qualified A1 expressions are exercised; named, R1C1, external/3D,
  full-row/column and other reference grammar is not qualified and may produce
  different classification. Existing typed SDK updates retain their semantics.
- Exporters lacking subset/split abilities have native diagnostics. Supported
  subset/split execution remains explicitly unsupported, including native fd split
  template/publication behavior. Common sheet lookup and option syntax are tested;
  provider-specific export-option values require the injected handler and are
  not universally qualified.
- Unquoted non-ASCII export-option keys still use ASCII classification: native
  GLib can classify them as an unknown key while this parser reports syntax error.
  This is a remaining mismatch for opt-in UTF-8 argument profiles. Unicode
  whitespace/category completeness and non-C translations are unmeasured.
  Non-ASCII diagnostic text encoding and native C-locale fallback are also
  unqualified beyond the captured listing bytes.
- Plain POSIX resource identities are exercised. Unusual scheme canonicalization,
  reserved-character escaping, non-UTF-8 filenames, descriptor aliases/other
  descriptors and platform-specific URI behavior are not qualified; CLI currently
  routes only exact `fd://1` with an explicit exporter to stdout.
- Known injected filesystem errnos and typed sink failures are exercised. Native
  fd write/close failures, partial publication, symlink/permission/backend
  differences and every errno spelling are unmeasured. Stream-iteration and codec
  exceptions stay opaque unless typed; no native fixture for each was measured.
- Graph/clipboard/resize/tool-test/solver/recalc and inherited environment/plugin
  side effects retain earlier incomplete coverage. Unsupported early actions can
  have different native failure precedence. Optional Psiconv/plugin/locale gates
  in the captured profile remain incomplete; listings do not certify those formats.

Checks use the dirty live worktree; no frozen archive/release candidate is
claimed. Aggregate accepted cells/sheets and input bytes are exercised; this
does not establish one aggregate RSS or retained text/node-memory bound across
opaque decoders, retained inputs and merged snapshots.

No README changes, commits, pushes or publications were performed. Unrelated
worktree edits were preserved. Root retains Git/export/integration ownership.
Owned `out/ssconvert-listing` scratch was purged after final checks and reduction.
