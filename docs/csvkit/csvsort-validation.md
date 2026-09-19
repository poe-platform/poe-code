# csvsort validation, September 18 2026

The literal csvsort executable uses the existing opt-in fourteen-command registration and the shared SDK engine. This change does not qualify the other thirteen commands or claim complete csvkit parity.

## Frozen measurements and TDD

The owned `out/csvsort-reference` environment replayed the hash-required CPython3.14.2 runtime lock (Agate1.14.2, SQLAlchemy2.0.54 and the remaining declared dependencies). Installed csvsort source bytes matched the authenticated source-manifest entry from the required csvkit2.2.0 archive. Native CLI captures used only PATH=/usr/bin:/bin, LC_ALL=C, LANG=C, TZ=UTC, PYTHONIOENCODING=utf-8, COLUMNS=80, LINES=24 and non-TTY UTF-8 pipes. `csvsort-reference.json` records 21 original observations with exact stdout/stderr/status, profile/source identities and the captured warning deployment path. Canonical tests consume static observations with injected in-memory stdin and capabilities; they do not run native programs, Python, network or real databases.

Original failing regressions reproduced Unicode ignore-case refusal (status78 instead of stable expanded-key sorting), Decimal NaN refusal (status78 instead of InvalidOperation/status1), and duplicate/unnamed header refusal despite injected warning identity (status78 instead of renamed headers/warnings/status0). Each failure was observed before its implementation. Subsequent tests cover singleton/unselected NaN, selected/all/duplicate columns, reverse null placement and stable ties, 512 numeric rows, Boolean/date/duration output normalization, huge Decimal values, no inference, no leading zeroes, names early exit, generated headers, zero indices and source-exact flag collisions.

The frozen uppercase table contains all 1,552 nonidentity CPython3.14.2 Unicode16 mappings. A fresh exhaustive development measurement compared every scalar against the interpreter. The source table SHA-256 is `a40e28a71f6e5f003a172c4ef783a3be5725627ffc129a559034774bfc1bfbcb`. Independent tests also catch adoption of Unicode17 casing for U+A7CF, expansion ties, dotless I, long s and Kelvin behavior. Original values are preserved in output.

## Final checks

- Maintained csvkit workspace `npm test`: 42 files, 1,885 passed, one skipped and six TODOs. Those existing skips/TODOs remain unqualified, never passes. Thirty tests in csvsort.test.ts include 21 exact differential observations and cancellation/backpressure checks.
- `npm run lint --workspace=@poe-code/csvkit`: passed source lint and both maintained source/test TypeScript checks.
- Selected maintained `npm run build:workspaces -- --workspace=@poe-platform/safe-bash`: passed ten declared dependency builds, guarded integration/build emit and postbuild.
- Maintained safe-bash `test:runner`: 536 passed, including exact csvsort stress-file discovery membership.
- Focused serial Node/tsx shell route: 126 passed across csvsort, csvkit engine, table, selector, temporal and numeric stress files. A different agent authored/executed 14 original csvsort Shell cases, including injected warning provenance/suppression and deliberate status78 without provenance. Filesystem effects use MemoryFileSystem and assert preserved source bytes. Stream cases cover reused producer bytes and finalization.
- Scoped safe-bash ESLint on the changed plugin and new stress test: passed.
- Initial strict safe-bash typecheck exposed a suppression-profile declaration mismatch. The declaration now permits omission of utilsPath when suppressWarnings is true; the rebuilt source/test check passed. Final maintained typecheck passed source/tests, 26 current consumer groups and expected negative diagnostics; this is compile acceptance, not runtime acceptance.

An attempted maintained-test selector `--test-rg` was rejected by Node, status 9. The subsequent SAFE_BASH_TEST_RG environment variable did not filter this workspace's native runner, so the inadvertently full 1,215-file run was stopped and is incomplete evidence. Acceptance uses the explicit focused route above and the separate maintained runner/build/type routes, not those attempts. No full repository test/lint or release acceptance is claimed.

## Visual check and limits

The maintained `npm run screenshot -- --output out/csvsort-visual.png node out/csvsort-visual.mjs` rendered the actual built Shell numeric reverse/null/stable-tie output, Unicode uppercase sorting and zero-based names. The image was inspected: order and layout matched expectations. Its bundled terminal font lacks the FFI ligature glyph and displays a missing-glyph box; exact UTF-8 command output is independently verified. The capture used the maintained generic command screenshot route because csvsort is a Shell plugin, not a poe-code CLI subcommand. Owned visual and reference artifacts were purged after reduction.

Header warnings require an explicitly injected frozen Agate utilsPath or suppression. Error cases with `-v` still require qualified frozen traceback frames/deployment identity and otherwise return status78. Common documented unsupported locales, temporal hypothesis diagnostic boundaries, parser/encoding capabilities and resource limits remain in force. Every locale/date grammar, native interactive/SIGPIPE behavior and the secondary CPython3.9.6 profile remain unmeasured by this cohort. No database/network effects or release delivery are inferred. README, Git staging, commits, push and publication were not performed.
