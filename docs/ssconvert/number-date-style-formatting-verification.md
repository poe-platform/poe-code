# Number, date, style and text formatting verification

The subsequent [current candidate verification](number-date-style-formatting-current-verification.md) records the precision/scientific repairs, repeated main-cohort comparison and fresh checks. The results below describe the earlier candidate; its above-100 scientific precision limitation is repaired in the subsequent measured cohorts. Its ten preserve-layout mismatches remain open.

The local TypeScript ESM candidate has a shared formatter under `packages/ssconvert/src/formatting`. Formula TEXT and the SDK's exported `createFormattingCapability` / `renderCellText` use that implementation. The invocation context receives the supplied or default formatter; the opt-in safe-bash `ssconvert` command uses the same engine with injected byte I/O. Native ssconvert is only a separate QA oracle. This report establishes bounded formatting coverage, not complete GOffice display parity.

## Reference and reproducible evidence

[The captured profile](number-date-style-formatting-profile.json) records source URLs and hashes, candidate HEAD/source hashes, original fixture bytes, oracle argv/status/stdout/stderr/export bytes, dependency packages, linked-library hashes, binary identity, Docker image, font selection, locale and plugin inventories. Gnumeric 1.12.61's official archive matched SHA-256 `2ac135d856572713c1a408b76b50a59f2a9769ed21f1213446b5af255df20a12`. GOffice 0.10.61 matched the official checksum `558597fd9ca59b93ff562750218d1e7ea8ec3c8d0ed6a5cc096aa715ef909a15`. Primary source acquisition and native helpers stayed under owned `out` scratch; source is not copied into product files or durable documentation.

The oracle is the preexisting isolated Docker native installation. C / UTC and an isolated `de_DE.UTF-8` locale were captured, including explicit HOME/XDG/schema settings. The German locale was compiled from an authenticated-by-hash captured Debian locale package under scratch, without changing the system locale. The plugin helper mirrored native initialization and activation: 47 active, zero inactive, exit zero with no diagnostics. Dependency/plugin/locale profiles are part of the reference, not inferred from version strings alone.

Primary semantics were checked in released `src/stf-export.c` (automatic selection around line 158 and mode selection around line 241), `plugins/fn-string/functions.c` (TEXT around line 1158), GOffice `goffice/utils/go-format.c` (decimal placeholder operations around line 4332 and General rendering around line 4926), and `goffice/math/go-dtoa.c`. File hashes in the profile bind those citations to the acquired releases.

Original small XML fixtures and in-memory tests establish the measured cases. Initial exploratory formulas with incorrect quote/backslash encoding, and an invocation missing schema configuration, are unqualified. Their original exact initial bytes were not retained; they are not proof or passes. Corrected fixtures are recorded separately.

## Implemented behavior and boundaries

The formatter scans quoted/escaped sections, numeric placeholders, decimal/group/scaling/percent tokens, conditions, color tags and currency/LCID symbols. It renders General, precision, exponent/engineering notation, variable/explicit fractions, dates, times, AM/PM, repeated elapsed units and custom literals/digit masks. Colors are parsed independently of plain-text output; formatting does not mutate cell styles.

Decimal formatting rounds binary64 once, suppresses rounded negative zero, expands large fixed values to their exact binary64 integer, and handles supported precision above JavaScript's 100-place `toFixed` ceiling using exact rational rounding. Concrete native evidence establishes away-from-zero exact halves. Scientific subnormal examples, optional fractional placeholders and conditional negative-sign inhibition have independent regression coverage; this does not establish every binary64 boundary.

`renderCellText` chooses the cached value where present. Raw emits localized round-trip scalar text. Automatic selects canonical dates/times from format tokens and otherwise scalar General, with localized numeric fallback for invalid dates. Preserve uses authoritative `displayedText` when supplied, otherwise the injected/default formatter with Unicode minus. The default formatter is an unlimited-width string formatter; a finite-font layout capability may be injected. Captured display is not independently regenerated or proven fresh after every workbook edit.

Explicit locale profiles determine separators, month/weekday names, booleans and error translations. Stored/SDK XL masks remain canonical; formula TEXT accepts locale-spelled masks and measured German scalar string matching. Ambient `Intl` behavior is not used as a parity guarantee. C and German have native byte measurements; English/C aliases share profiles but were not each independently measured.

Formatting leaves fonts, fills, borders, alignment, rotation, wrapping, indentation, protection, themes/palettes and rich-text records untouched. An in-memory immutability test contains every listed category; the actual command/SDK memfs case also preserves the borrowed workbook and namespace ordering. This is preservation of independent records, not proof of complete style serialization by every codec.

UTF8 pattern/output admission, work limits, cancellation and injected-capability result checks remain enforced. Cancellation after asynchronous formatting preserves the borrowed abort reason. No native spawn, host-file access, LLM query or fallback is introduced in product formatting or unit tests. Existing realm/replay behavior was not changed; this formatting cohort does not independently establish all realm/replay invariants.

## Measured results

The final main comparison contains 287 byte comparisons: 41 formula TEXT and 41 cases in each of automatic/raw/preserve for C and German. Results are TEXT 41/41, automatic 82/82, raw 82/82, preserve 72/82: **277/287 match**. Twenty additional locale/formula/typed-value cases and four large-fixed cases match. Supplementary root captures verify all six German error translations, invalid-date localization, German numeric string matching, optional zero and DOLLAR/FIXED rounded negative zero. These cohorts are separate and are not summed into a universal coverage claim.

The manual's date distinction was verified using actual bytes from the original serial 45292.5 with `yyyy-mm-dd`, rather than treating its example as proof:

| Mode | Oracle text | UTF8 hex excluding row terminator |
| --- | --- | --- |
| automatic | `2024/01/01 12:00:00` | `323032342f30312f30312031323a30303a3030` |
| raw | `45292.5` | `34353239322e35` |
| preserve | `2024-01-01` | `323032342d30312d3031` |

The [independent reviewer](number-format-independent-verification.md) added failing regressions before validated repairs and confirmed **90/90 final independent tests**. Its [profile](number-format-independent-profile.json) separates corrected native cohorts from exploratory fixture defects. Unit cases include epoch selection, phantom/out-of-range serials, serial round trips, cached results, display preservation, budget and cancellation paths; native differential coverage is limited to the recorded fixtures.

## Every remaining main-cohort mismatch

These five cases fail in both C and German preserve mode, for ten total differences. German changes decimal punctuation where applicable. Full expected/actual hex is retained in the profile. No supplied `displayedText` or font renderer was used in this comparison.

| Value and mask | C oracle preserve | Default product preserve |
| --- | --- | --- |
| 12, `*x0` | `xxxxx12` | `12` |
| 1.2345678901234567, General | `1.234568` | `1.2345678901234567` |
| 12, `_($* #,##0.00_);_($* (#,##0.00);_($* "-"??_);_(@_)` | space, `$`, three U+200A hair spaces, two spaces, `12.00`, space | ` $12.00 ` |
| 1e16, General | `1E+16` | `10000000000000000` |
| 2.5, `# ?/?` | `2  1/2 ` | `2 1/2` |

These are measured failures of the default preserve fallback. Native preserve rendering uses font/column constraints, fill repetitions and font padding; native TEXT uses unlimited-width string rendering. Captured display preservation and injected formatting provide mechanisms, but do not erase these failures or establish an implemented native font renderer.

Other unsupported or unmeasured cases are not passes: arbitrary locales/LCIDs and numeral shaping; German temporal string coercion; every currency/date tag or malformed grammar; scientific masks above the existing supported 100-place precision; fraction unsafe-integer/epsilon boundaries; arbitrary literal/scientific/date combinations; every rounding or serial-precision boundary; finite-width font metrics; all theme/palette/rich-text codec round trips. The existing codec lifecycle is not expanded into a complete Gnumeric file-format implementation by this formatter.

## Final local checks and delivery

| Check | Result |
| --- | --- |
| `npm run build:workspaces -- --workspace=@poe-platform/safe-bash --no-cache` | exit 0; maintained selected dependency closure including ssconvert |
| `npm test --workspace=@poe-code/ssconvert` | exit 0; 125 files, 3,355 tests; fresh execution |
| `npm run lint --workspace=@poe-code/ssconvert` | exit 0; ESLint and source/test TypeScript |
| `node --import tsx --test --test-concurrency=1 packages/safe-bash/tests/commands/ssconvert.test.ts` | exit 0; 39 tests, zero skipped/TODO |
| Independent formatter and cell-selection suites | 90/90 confirmed by the different agent |

Unit child environments cleared names from `git rev-parse --local-env-vars`; parent and private/global Git settings were preserved. The build selected dependencies from maintained declarations and bypassed the cache. An earlier attempted safe-bash workspace test incorrectly used `SAFE_BASH_TEST_RG` as a file selector; it launched the whole runner and was stopped. That run is incomplete, not a whole-safe-bash or root test pass. No repository-wide lint or full-root test pass is claimed. Output changes are conversion data bytes, with no visual CLI interface change; screenshot verification was not performed.

Candidate source bindings and check-log hashes are in the profile. This is an uncommitted local candidate atop existing untracked package/integration work. No staging, commits, remote-main delivery, release, push/publication or README edits were performed. Owned temporary evidence is removed after reduction; preexisting oracle sources/container and unrelated work remain intact.
