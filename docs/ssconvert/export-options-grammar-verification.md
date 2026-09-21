# Export options grammar verification

Verified 2026-09-19. Scope: released-source option grammar, exporter dispatch and
image-resolution admission in the shared TypeScript SDK/virtual command engine.
This is not a claim of complete Gnumeric conversion or rendering compatibility.

## Reference and provenance

The existing primary Gnumeric archive in `out/ssconvert-lifecycle` was
authenticated again: 1.12.61, SHA-256
`2ac135d856572713c1a408b76b50a59f2a9769ed21f1213446b5af255df20a12`.
GOffice 0.10.61 archive SHA-256:
`558597fd9ca59b93ff562750218d1e7ea8ec3c8d0ed6a5cc096aa715ef909a15`.
Primary source remained in `out`; a task-owned GOffice extraction was purged.
No primary source was copied into product code.

The captured reference dependency/plugin/environment census remains
[reference-profile.json](reference-profile.json), with the smaller captured
C/UTC CLI profile in [glib-cli-parser-profile.json](glib-cli-parser-profile.json).
That profile uses GLib 2.84.4, GOffice 0.10.61 and libgsf 1.14.53. Native binaries,
libraries, plugins and configuration roots are QA provenance only.

Source authorities inspected:

- GOffice `goffice/utils/go-glib-extras.c`: `go_parse_key_value`,
  `go_strunescape`, `go_object_set_property`, `go_utf8_collate_casefold`.
- Gnumeric `src/ssconvert.c`: saver handler selection, diagnostics,
  `cb_image_export_options`, default resolution and save-time ordering.
- Gnumeric `src/gutils.c`: common `sheet`/`active-sheet` handling.
- Gnumeric `src/stf-export.c`: text option/property handlers and enum values.
- Gnumeric `src/print-info.c`: PDF option-handler/common-option routing.
- libgsf `gsf/gsf-output-csv.c`: configurable CSV quoting enum names/nicks.

Docker was unavailable during this task. The exact captured native ssconvert
binary was **not rerun** for these new cases. Source-based verification and
supplementary host-library comparisons are recorded separately below.

## Implemented and verified behavior

Concrete regressions failed before their repairs: C-string termination, signed
hexadecimal numeric prefixes and hexadecimal floats, quoted non-ASCII numeric
whitespace, text value diagnostics/first failure, long hex significand overflow,
subnormal rounding and registration-time rule ownership. Boolean full case folding
was validated with an SDK case; the CLI retains its C-locale argv conversion
behavior rather than bypassing it to accept non-ASCII bytes.

The parser retains Unicode whitespace, Unicode/alphanumeric and allowed bare
keys, quoted keys, mandatory equals with optional surrounding whitespace,
literal backslash escapes, quoted/unquoted/empty values, adjacent quoted pairs,
ordered duplicates and lazy first failure. Unterminated quoted strings and
syntax errors retain the native diagnostic text. Embedded NUL terminates the
SDK option string, including unterminated-quote behavior before that terminator.

Provider rules declare string/boolean/enum handlers. Registered maps, rule
objects and enum arrays are owned and frozen. Rules run before common options;
key-list metadata alone does not authorize an option. Text handlers validate
EOL names, exact enum names/nicks and C-locale boolean names, including Unicode
case folding. Common sheet options preserve order and duplicates, and
`active-sheet` ignores its value. Plain `Gnumeric_stf:stf_csv` receives common
options and rejects configurable-text options. The existing explicit
`Codec.exportOptions` callback remains an exporter-owned whole-string handler;
such a handler owns parsing and its common-option fallback, as the native saver
signal handler does. Raw ordered options are passed to the selected writer.

Graph `-T` continues to select an image ID. Only `resolution` is accepted in
image options. The parsed resolution is passed to the injected renderer,
defaults to 100 and admits inclusive bounds 1..10000. Last repeated resolution
wins; an invalid earlier pair fails immediately. C-locale numeric-prefix
semantics include malformed exponent suffixes, signed hex integers/floats,
trailing text and ASCII numeric whitespace. The hex significand retains at
most 60 bigint bits plus a sticky tail; exponent cancellation and ties-to-even
do not require unbounded bigint storage. JavaScript binary/octal forms,
out-of-range/nonfinite results and non-ASCII numeric leading whitespace fail
with the original key/value diagnostic. Validation remains at save time.

The virtual command uses the SDK engine, injected byte I/O and rendering,
existing cancellation and publication ownership. Memfs assertions verify
unchanged output namespace on handler failures and exact stderr/status/order.
No unit tests introduced native spawns, host file writes or LLM calls.

## Completed checks

| Check | Verified result |
| --- | --- |
| `npm run build:workspaces -- --workspace=@poe-platform/safe-bash --no-cache` | Exit 0; declaration/source build and native npm lifecycle stages for the maintained selected dependency closure; 18 build tasks derived by the runner |
| `npm run test --workspace=@poe-code/ssconvert` | Exit 0; 33 files, 475 tests; direct workspace route is uncached |
| `npm run lint --workspace=@poe-code/ssconvert` | Exit 0; maintained ESLint and product/test TypeScript checks |
| `node --import tsx --test packages/safe-bash/tests/commands/ssconvert.test.ts` | Exit 0; 21 registered command integration tests, no skipped cases |
| Different-agent stress/fix | 30 independent tests pass; bounded numeric repair and root-owned rule ownership repair |
| Supplementary released GOffice parser-function comparison | 49 cases, zero differences in ordered UTF-8 key/value bytes, errors and status; compiled released functions against **host GLib 2.88.0**, not the captured GLib profile |
| Supplementary host-libc hexadecimal comparison | 2,000 deterministic cases, seed 61261, zero differences; significand lengths 1/2/13/14/15/16/40/300, signs, point positions, trailing text and exponent extremes; not a Gnumeric-profile qualification |
| `npm run lint:eslint` | Complete guarded run, exit 0, zero errors and four warnings; 16,541 subjects, no guard failure or exclusion change |
| Actual virtual-command diagnostic screenshot | Generated using maintained `npm run screenshot`, viewed: legible full diagnostic lines, failure status 1, PNG numeric-prefix resolution 4 and default 100 with status 0 |

The screenshot SHA-256 was
`3d5ccf2dfd2aeca2563435cb5ade99e408fa9aaf243fbbb189c71b59ec195f52`.
The supplementary numeric-vector SHA-256 was
`0ef8c06d18eb4c3d82647cbcbbba9bb5ee7dde4259a71c7fa3c0ad7da8f51736`.
Owned temporary vectors, compilation artifacts, logs and screenshots were
purged after recording results. Existing other-task artifacts were preserved.
The integration file already has its exact literal membership assertion in
`packages/safe-bash/scripts/integration-inputs.test.mjs`; no registration edit
was needed.

## Remaining mismatches and unmeasured checks

- `npm run typecheck --workspace=@poe-platform/safe-bash` exits 2 before consumer
  checks: **Public SafeFS must preserve shared SafeJS runtime identity**; actual
  root export import mapping is undefined, expected
  `./packages/safe-js/dist/safe-fs.js`. The current checkout has no `./safe-fs`
  export. This check is a failure, not a consumer pass; this task did not change
  the unrelated root export contract.
- A mistakenly selected complete Safe Bash `npm test` run was stopped. The
  `SAFE_BASH_TEST_RG` environment variable does not select files in that direct
  package test script. The complete suite and root `npm test` are **not passes**
  for this task; the exact registered command file was run separately.
- New grammar/text/numeric cases have not been measured against the exact
  captured native ssconvert dependency/plugin profile in a fresh execution.
  The 49 source-function and 2,000 libc comparisons cannot substitute for it.
- This dispatch change does not implement text byte serialization, character
  conversion/transliteration, locale-sensitive formatting, PDF object lookup or
  GTK paper-size validation. PDF string rules preserve grammar/dispatch only;
  complete PDF value/domain semantics require the exporter's explicit handler.
  Injected writer/renderer tests do not qualify native output bytes, duplicate
  scalar effects in a real format writer, image dimensions or rendering fidelity.
- Other locale profiles, translated boolean names/diagnostics and non-C numeric
  decimal separators are unqualified. Invalid UTF-8/lone-surrogate SDK option
  strings are not qualified by the Unicode-string grammar cases.
- Internal finite-prefix helper results for textual `inf`/`nan` and some
  no-conversion spellings differ from libc. They are all rejected identically by
  image bounds with the original diagnostic; the helper is not a public numeric
  parser API.

No README files were edited. No local commits, remote-main delivery, push or
release publication occurred. Existing unrelated edits were preserved.

QA procedure: [export-options grammar QA](../plans/ssconvert-export-options-grammar-qa.md).

## Independent current-candidate audit

Rechecked on 2026-09-19 at base Git HEAD
`b97c4938a469ee70e09bd08a0e5fcf7e868ca04c`. The implementation and earlier
regressions above were already present at task entry. This audit preserved them;
it introduced no production repair and therefore claims no new red/green cycle.
The different-agent stress review added only
`packages/ssconvert/src/cli/export-options-independent.test.ts` (SHA-256
`b3a2055a27c80cec5bacdd14c83c49db7baad0c0d063b3d3694f7599fccefc42`).
No new grammar or resolution mismatch was validated.

The exact audited source/test candidate contains 92 `.ts` files selected by
`packages/ssconvert/src/**/*.ts`,
`packages/safe-bash/src/commands/ssconvert/**/*.ts`, and the registered
`packages/safe-bash/tests/commands/ssconvert.test.ts`. Sort relative POSIX paths
lexicographically, concatenate each UTF-8 path, a NUL byte and its raw SHA-256
digest, then SHA-256 the concatenation. Candidate digest:
`2825dd3b42551c8d80776eb8d4e8db11edba3afec90f8968c9418b2e1e82aa19`.

The Gnumeric source archive hash above was reverified. GOffice 0.10.61 was
downloaded from the official GNOME archive solely into task-owned
`out/ssconvert-grammar-audit`, authenticated against the hash above, and its
parser/unescape/property implementations inspected directly. Source review
also checked Gnumeric common-option routing, configurable text routing,
sheet-selection validation and image-save option ordering.

The six independent deterministic tests cover the ASCII bare-key alphabet,
all captured GLib whitespace separators and adjacent negative controls,
literal escapes without C/shell evaluation, adjacent empty quoted keys/values,
lazy syntax/unterminated-string errors, 527 exact binary hexadecimal fractions,
and rounding immediately around the inclusive 1/10000 image bounds. These are
source/arithmetic checks, not native-profile differential or performance passes.

Current completed gates:

- Uncached maintained Safe Bash workspace build closure: exit 0, 18 build tasks
  selected by declarations, including ssconvert and Safe Bash.
- Maintained ssconvert package tests: exit 0, 34 files, 481 tests, no skips.
- Maintained ssconvert package lint and source/test TypeScript: exit 0.
- Actual registered Safe Bash command integration: exit 0, 21 tests, no skips;
  includes shared CLI/SDK behavior, byte budgets, cancellation/ownership failure,
  hidden capability denial, unchanged memfs namespaces and injected I/O.
- Markdown QA steps executed manually; actual virtual-command screenshot
  generated with maintained `npm run screenshot` and inspected. Plain CSV
  rejects `separator`, quoted syntax and missing equals retain complete legible
  diagnostic lines and exit 1. Screenshot SHA-256:
  `268219f80e76aea77c1f0e62bf14f2dfea6dc199dcbad22f4b092057564e2578`.

Current failures/unavailable/incomplete gates are separate: Docker daemon
connection fails, so the exact captured native profile and mapped optional
plugin/locale runtime cells remain unverified. No new full root test/lint/build,
complete Safe Bash suite, SafeJS realm/checkpoint/replay, or performance matrix
was executed for this test-only audit. The earlier failed consumer typecheck
and canceled suite remain failures/incomplete evidence, not superseded by these
focused passes. The remaining domain/serialization/locale mismatches listed
above still apply. No test skips occurred; unavailable cells are not passes.
Task-owned primary source, launcher and screenshot were purged after recording.
Other edits and artifacts were preserved. No README edits, commits, push or
publication occurred.
