# Current configurable text candidate verification

The current working tree already contained distinct configurable-text and plain
CSV writers, provider registration, SDK and virtual-command integration. Those
edits were preserved. This review added independently derived edge cases and a
TDD repair: ISO-8859-1 `é` plus newline requires two output bytes, but the original
writer rejected a two-byte budget by charging its three intermediate UTF-8 bytes.
The writer now bounds retained text by scalar count and admits exact final bytes
through the encoder. Invalid-converter UTF-8 fallback also observes that byte limit.
Intermediate strings remain bounded: at most four UTF-8 bytes per admitted scalar.

A second failing regression found that formatting a dense `éé` field still charged
four intermediate UTF-8 bytes against its three-byte Latin-1 output budget. All
three format modes failed before repair: automatic/raw reported
`ssconvert formatting text limit exceeded`, and preserve reported
`ssconvert calculation text limit exceeded`. The expected final bytes are
`e9 e9 0a` at a three-byte budget. Non-UTF-8 rendering now receives a bounded
intermediate allowance; layout and encoding retain the original final-byte limit.
Default UTF-8 limits and diagnostics remain unchanged.

The official archive in `out/ssconvert-lifecycle` hashes to the requested
`2ac135d856572713c1a408b76b50a59f2a9769ed21f1213446b5af255df20a12`.
Source review confirms the stable `src/stf-export.c` whitelist and separate
`src/stf.c:stf_write_csv` behavior. `formulas=true` and configurable options on
plain CSV reject; `--import-options` remains nonexistent. The existing
[reference profile](configurable-text-export-profile.json) was independently
reauthenticated against the running oracle: binary SHA-256, every captured plugin
hash, installed locale inventory and four installed dependency versions match.
Native utilities remain separate QA oracles and never execute in product or units.

The candidate writer SHA-256 is
`478cdf0625c00ba24470d64cf7096488d65ccb8235d2711b6108141da1dc250f`.
The boundary-test SHA-256 is
`54a47373681ebc6aed353f555c934da7d378fe232eed22c6f1853c04791a7d4a`;
the independent stress-test SHA-256 is
`5dadfb06d0aba15e7635ee726f26115e6ed855c7ef1c645f2f39347da7190128`.
No commit, push or publication was performed; these identify working-tree bytes,
not a delivered Git revision. The unchanged Git base is
`b97c4938a469ee70e09bd08a0e5fcf7e868ca04c` on `main`.
The candidate ran on Node.js 22.22.2. Its 288-file path/content fingerprint is
`ff5805a541df1841a47ae3a61c329a1d0c4320dac6b81a31f8f7383e512f1f86`:
sort ssconvert `src/**/*.ts`, `scripts/*.mjs`, package-root `*.json`, root
`package.json`, and safe-bash `package.json`, `scripts/build.mjs`, `src/index.ts`,
`src/commands/ssconvert/index.ts`, and both `tests/commands/ssconvert*.test.ts`;
hash concatenated UTF-8 paths, NUL, and each file's raw SHA-256 digest.

## Fresh deterministic passes

- Maintained ssconvert package tests: 3,523 passes in 135 files, no failures/skips.
  Maintained package lint includes ESLint, source TypeScript and test TypeScript.
- Repository-wide guarded ESLint ran uncached: zero errors, four warnings
  (docx operation-types, safe-bash docx table-model and zip-review unused variables).
  Repository-wide TypeScript and workflow lint routes passed. After the final
  repair, the maintained guarded ESLint replay completed with zero errors, four
  warnings and 16,671 cached files; repository-wide TypeScript checks passed again.
- Maintained uncached safe-bash workspace build closure passed before the dense-field
  repair. The final candidate then passed the maintained uncached ssconvert build
  closure. The earlier safe-bash build included native
  npm lifecycle stages. Actual virtual ssconvert integrations rerun after the
  final repair: 43 passes, no
  failures/skips. Maintained safe-bash runner: 558 passes, no failures/skips.
- Fifteen original CSV native/SDK cohorts matched all statuses and destination
  bytes; fourteen matched stderr with an absolute oracle invocation. The remaining
  help-hint difference was recaptured through PATH as `ssconvert` and matched
  completely, preserving both observations without normalization. Cases include
  defaults, multichar quotes/separators, empty quotes/separators, automatic/preserve
  formatting, mixed-case eol, embedded newline, Latin-1, ASCII escaping, invalid
  enums/booleans, unknown sheets, formulas rejection, plain-CSV option refusal and
  nonexistent import-options. The final rebuilt candidate reproduces all fifteen SDK results.
- C and C.UTF-8 runtime cells were independently measured. Non-ASCII `-O` argv
  rejects under C before any host read and matches the complete native status,
  diagnostic and unchanged destination. With an explicit UTF-8 argument profile,
  C.UTF-8 two-emoji quotes match native per-scalar doubling, status and stderr.
  A direct SDK accepting Unicode strings is a separate boundary from CLI decoding.
  Three supplemental `charset=ASCII` cells under the pinned C environment also
  match all statuses, stderr and bytes: `locale=C`, `locale=C.UTF-8` and
  `locale=bogus` each export `é € 漢 😀` as `"? EUR ? ?"` followed by LF. The root
  independently recaptured these after the stress agent's measurement.
- Six fresh original two-sheet cohorts match all statuses, stderr and destination
  bytes: all-sheet configurable defaults, ordered `Second/First/Second`
  concatenation, blank `First!B2:C3`, explicit First-sheet CSV, multiple-sheet CSV
  refusal retaining the destination, and active Second-sheet CSV defaults.
  The minimized sheets contain only `tail` at B1, `end` at A3 and `bee` on Second.
  The first fixture attempt used default XML namespace without Version, causing
  native legacy interpretation and two extra empty sheets; its custom SDK probe
  also lost to the built-in CSV probe. These are invalid measurement fixtures,
  not exporter findings or passes. Explicit `gnm` namespace/Version and explicit
  fixture importer corrected both; original and corrected captures were retained
  separately until summarization and cleanup.
- A different agent measured Unicode whitespace with an original eight-row
  Gnumeric XML fixture. NBSP/U+2028/U+2029/U+3000 quote; U+0085/U+180E/U+FEFF do
  not. GLib confirms vertical-tab nonspace separately. Fifteen independent stress
  regressions include those classes, NUL truncation and encoding negative controls.
- After the dense-field repair, a different agent passed 18 independent runtime
  cells: ASCII Han, UTF-16LE Han and Latin-1 accented fields, each across all
  three format modes and exact/smaller budgets. Formatter attempts to mutate or
  replace its limit cannot enlarge the final limit. Awaited cancellation retains
  the exact reason object. No new mismatch was found. These are deterministic
  semantic checks, not performance measurements.
- Original CLI, owned-workbook SDK, foreign-realm byte input and serialized
  checkpoint replay share the exact two-byte Latin-1 result. UTF-8 expansion
  fails without changing the prior destination or creating extra namespace entries.
  The real virtual command independently preserves raw stdout byte identity and
  refuses over-budget UTF-8 with empty stdout. Existing formatting cancellation
  coverage preserves reason identity and refuses publication.
- Manual CLI screenshot inspected: the virtual command displays `label::value`
  and `"edge,quote"""::1.20` correctly with preserved formatting and custom separator.
  The two-byte Unicode negative control displays exactly
  `ssconvert output bytes limit exceeded` and returns one with no stdout. An
  earlier header-based control reached the formatting text limit first; that
  screenshot was also inspected, but was not substituted for the byte control.
  The final rebuilt candidate was captured and inspected again with the same
  successful output and byte-limit diagnostic. One QA invocation accidentally
  used unsupported `fd://stdout`, correctly rejected with status one; it was
  corrected to the supported `fd://1` before the successful capture. The temporary
  host and images are purged after inspection.

## Completed broad run, exclusions and revision boundary

`npm test -- --no-cache` completed with exit zero, including native npm posttest
(`test:stress:lint`: two passes). Its maintained declaration-derived plan selected
85 workspaces, 33 prerequisite builds and 53 unit stages; these are observations
of that plan, not hardcoded task membership. It reports 33 workspaces with no
declared unit task, which are not passes. Vitest summaries report 50 skipped
tests (two shared batches each skip one, SafeJS skips 48) and five TODOs.
SafePython passes 84,610 tests across 1,153 files; its 42 quarantine patterns are
excluded and unverified. SafeJS passes 31,121 tests across 1,467 files and skips
three files. The ssconvert stage ran after the repair and passes all 3,523 tests.
No test failure or timeout occurred. `npm run build` then completed against the
final candidate, including declaration-derived workspace builds, root schema
generation, TypeScript, wrapper generation and bundling. The workspace report
selects 85 workspaces and executes 84 build stages; one workspace has no declared
build and is not a pass. Shared caching is enabled, with zero hits and 48 misses
among its admitted cache tasks. The final 288-file source fingerprint is unchanged.
The built public `poe-code/ssconvert` export reproduces all fifteen command/SDK
outcomes. The built public safe-bash export also passes dense Latin-1 exact-byte
stdout and a UTF-8 negative control, preserving its formatting-limit diagnostic.
The first ad-hoc JS call omitted required `codecs`; the next incorrectly treated
decoded `stdout` as bytes. Both QA call mistakes were corrected using `codecs: []`
and `stdoutBytes`; neither is counted as a product regression or a pass.
Unavailable `just-bash` comparison cells
remain pending regardless of their wrapper execution.

The full run began before the dense-field repair. Earlier builds and stages
used the earlier candidate; its completed exit-zero result therefore does not
prove a single exact-final-candidate broad run. Final package tests/lint, rebuilt
differential results, actual virtual integrations and the later maintained
ssconvert stage do exercise the final candidate.

## Failures, unsupported and unverified cells

Safe-bash's maintained typecheck failed before any compiler/consumer execution:
the current root manifest lacks the expected public SafeFS mapping
`./packages/safe-js/dist/safe-fs.js`. Its report records cleanup success. The
unrelated root manifest edits were preserved. This is a failed gate, not a pass.
An intermediate test-typecheck also found missing required stdout sinks in the
new test fixture; the fixture was corrected and the full package lint rerun passed.

Existing compatibility limits in the prior
[coverage record](configurable-text-export-coverage.json) still apply. Native
invalid-converter warnings include GLib process/time envelopes absent from product
diagnostics. The captured 1,180-name charset inventory classifies 1,025 names as explicitly
unsupported and 155 as reaching available routes. This is route classification,
not a character-repertoire pass. The prior mismatches name `charset=bogus` and
`x-mac-cyrillic` escape/transliterate GLib warning envelopes. Native
multibyte/stateful charsets and unlisted aliases remain unsupported or unmeasured;
arbitrary transliteration, charset suffix flags and
uncaptured locale/plugin/dependency profiles are unmeasured. No full native parity
claim follows from these cases. VT and NUL cannot occur in an XML 1.0 fixture;
their source/direct SDK coverage is distinct from native workbook differential
coverage. No bounded performance benchmark or real-service matrix was run.
The broad safe-bash log also reports pending third-party comparison cases because
the isolated `just-bash` comparator is not installed. Their wrapper execution is
not a compatibility pass for those unavailable comparison cells.

No workflow or shared infrastructure was changed. The broad uncached root unit
run began before the dense-field repair; its earlier stages exercised the prior
candidate. It cannot be reported as an exact-final-candidate broad gate. Final
package tests, lint, rebuilt differential outcomes and actual virtual integrations
were executed after that repair. Broader root unit/build results are recorded
separately from these scoped checks and selected workspace closure.
Procedures are in
[root QA](../plans/ssconvert-configurable-current-qa.md) and
[independent stress QA](../plans/ssconvert-configurable-current-stress.md).
