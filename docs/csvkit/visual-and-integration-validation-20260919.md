# csvkit visual and integration review, 2026-09-19

This review extends the existing TypeScript ESM domain engine and explicit
safe-bash command family. It does not establish full csvkit compatibility.
The fourteen independently expected original names match both public domain
descriptors and public `createCsvkitCommands` definitions. The root CLI/SDK
`bash` route has no csvkit capability binding; actual CSV terminal captures use
`Shell.use(csvkitCommands(bindings))`, without a new product subcommand.

The source archive was downloaded again: 3,820,365 bytes, SHA-256
`147318a8dbaec07c0bbb9291c14b78de5fa32ed3d4a5c2396e52a83c0a30df6b`.
The maintained source-manifest bytes reproduce
`373e84e792482061c1c18c2248a3d40c6657e0c26d5d72d0351950142878effe`.
Reference expectations use the recorded CPython 3.14.2 / Agate 1.14.2 /
SQLAlchemy 2.0.54 profile. Product captures execute the JavaScript engine with
explicit C locale, UTF-8, UTC and 80-column capabilities. This pass does
not newly reauthenticate a live reference interpreter's installed-file tree.
Independent cached native probes are source corroboration, as explicitly
recorded in the linked stress reports.

## Regression-driven changes

The independent agent reproduced and fixed Python versus JavaScript selector
whitespace in csvjoin; see [the six argv/SDK regressions and verification](csvjoin-whitespace-stress-validation.md).
The actual safe-bash command
`csvjoin -I -y0 -c $'\x1ck\x1f' /left.csv /right.csv` subsequently emitted
`k,a,b\nx,A,B\n`, empty stderr, status 0.

The same agent activated the frozen csvcut quoting regression before fixing
Runtime's early unsupported-mode check; see [bounded quoting support](input-quoting-string-validation.md).
Modes 2/4/5 now preserve string-only records and original conversion errors.
Numeric/null operation cells remain precise status-78 blockers, with already
written headers retained. The safe-bash recycled-buffer native numeric case
remains a TODO with its original successful reference output unchanged. A
VFS-script regression checks string-only
records, redirected outputs, source/script immutability and directory effects.

## Agent-executed visual QA

Procedure: [csvkit-safe-bash-qa.md](../plans/csvkit-safe-bash-qa.md), including
its explicit visual section. Temporary helpers, terminal captures and logs use
owned `out/csvkit-sept19-*` names; these are ad hoc execution aids, not screenshot
tests or a replacement QA program.
After review, the 45 owned temporary capture/helper/check-log paths were purged.
The broad-unit log and two isolated-control logs were reduced here and then
purged too; unrelated `out` evidence was preserved.

Actual registered commands were captured and opened using `view_image`:

- csvlook normal tables and width 12/8, row limit 2, column limit 3, precision
  2/0 and disabled numeric ellipsis. Inputs include long and multiline headers,
  multiline values, CJK/wide characters, combining accents and astral Unicode.
  Multiline headers keep upstream line breaks; they are not rewritten into a
  styled table. Upstream character-count padding is preserved.
- csvstat full Number/Text reports, null exclusion, repeated frequencies,
  decimal metrics and a separate maximum-precision report with long/multiline
  headers. Numeric formatting is explicitly injected from frozen measured C
  locale formatter observations, rather than guessed for unmeasured values.
- csvcut/csvstat names, csvlook help, version, argparse usage/error, sniff warning,
  unnamed/duplicate-column warnings, invalid selector and raw csvclean diagnostic
  CSV. Warnings/errors were redirected to VFS files and displayed through the
  existing registered cat command. CSV/JSON and paths remain unstyled.
- csvpy reader/dict banners, prompts, Python representations, division-by-zero
  traceback and EOF. CSV comes from FILE and Python stdin from a separately
  injected terminal. Both sessions return status 0; the missing Agate Table
  object library returns status 78 separately. All three acquired guest sessions
  close exactly once.
- The existing `poe-code bash --help` route through
  `npm run screenshot-poe-code -- --output out/csvkit-sept19-poe-bash-help.png bash --help`.
  Its option layout and wrapping are readable; it does not expose CSV commands.

Initial harness captures failed because the formatter and Python execution
limits were omitted, and cat was not registered. Those are retained observations
of failed QA setup, not passing product cases. Corrected captures use explicit
bindings and registered standard commands. The initial JetBrains-only PNG
renderer lacks CJK, emoji and newline-arrow glyphs. A separate system-font
fallback capture makes CJK, combining accents and arrows legible; emoji remains
an unavailable renderer glyph. Emoji byte comparisons remain separate from
unqualified visual glyph rendering. No product formatter was changed for PNGs.
The screenshot runner merges independently captured stdout/stderr pipes;
arrival order in that composite does not prove ordering across channels. Shared
redirected terminal-text captures retain observed write order, while canonical
regressions compare each channel independently.

## Checks and remaining blockers

Final domain verification passes 98 files and 4,395 tests, zero skips and five
TODOs. Domain ESLint and both source/test TypeScript checks pass. The maintained
safe-bash runner passes all 536 assertions. Public export imports and the exact
fourteen-name inventory were checked against a literal independent list.
The final domain source/test inventory contains 221 TypeScript files and hashes
to `ba3336eb631ac5d645a6b44596fd04a967524b0247e928bf5ff1c979ad8aa574`.
Definition: sort repository-relative `packages/csvkit/src/**/*.ts` path strings
using JavaScript's default `Array.sort()` (not component-wise path ordering),
construct `{path,sha256}` records using raw file bytes, then SHA-256 the compact
UTF-8 JSON array. This identifies dirty working-tree inputs, not a Git commit.

The normal root build including suffix stages passes after the final domain
changes. Maintained safe-bash source/test and consumer typechecks, root type lint,
workflow lint and focused ESLint also pass. The six affected integration files
pass 82 tests with one remaining numeric-cell TODO. Their initial run reproduced
stale all-mode blocker assertions; updates retain precise numeric/null blockers,
completed header bytes and positively exercised string-only behavior. No native
reference capture was weakened or rewritten.

The original csvcut case 37 also passes through actual Shell byte output after
activating its previously skipped integration regression; all 19 cases in that
file pass without skips/TODOs. The final CSV-family sweep passes 2,094 tests,
zero failures, one already-loaded obsolete csvcut skip and two explicit TODOs
(native numeric-cell serialization and unavailable `/dev/fd` paths). The separate
19-case activated csvcut run clears that one original observation; it does not
turn either TODO into a pass. The final guarded repository ESLint receipt is
complete with status 0, zero errors, two warnings and zero admission gaps. The
root lint chain's type and workflow stages also use their maintained routes.
An attempted broad `npm test -- --concurrency=4` used maintained uncached
declarations/hooks/closure, but timed out three SafeJS namespace/replay cases at
their unchanged five-second limits: `matches all native-anchored fields with
object/object registries`, `keeps aliases through three completed object-registry
replays`, and `keeps aliases through three completed map-registry replays` in
`namespace-identity-mc-002-validation.test.ts`. It was interrupted and is not a pass. The
original 18-case file then passed unchanged with one Vitest worker (15.55 seconds
total; previously timed replay cases approximately 1.8 seconds). The final broad
retry uses ordinary `npm test` with default sequential workspace scheduling,
declared dependency closure, native npm hooks and scoped child environments.
That ordinary run finished with exit 1 after the shared Vitest phase and earlier
native workspace tasks passed. Safe-bash's 1,270 admitted files reported 42,548
tests: 41,698 passed, 24 failed, one cancelled, 823 skipped and two TODOs
(1,436.72 seconds). These are safe-bash counts, not an aggregate repository pass.
The failed stage stops subsequent workspace tasks; their results remain absent.
During that retry, the original committed-archive check failed. A direct,
read-only invocation of `inspectCommittedCandidate` reproduced
`committed build input differs from reviewed authority: scripts/build.mjs`
at `committed-archive.mjs:525`. The check compares committed `HEAD` with the
current reviewed `packages/safe-bash/scripts/build.mjs`, which is modified in
the preserved working tree. This is an actual archive-qualification blocker;
neither committing unauthorized work, reverting preserved edits nor weakening
the authority comparison is an authorized repair.
The clean packed-revision S3 export test reported the same exact authority
mismatch. The other 22 failures share a public-cleanup `before` hook:
`Unadmitted peer public route: @e965/xlsx` at
`tests/plugins/qualified-current-release/peer.mjs:397`. The unchanged 22-case
original suite reproduced all 22 failures in isolation (2.12 seconds). Its
checkout peer includes the csvkit public runtime, whose external workbook
dependency is outside this verifier's admitted `poe-code/*` runtime closure.
This remains a dependency-feature qualification blocker; importing the public
export alone is not packed-consumer qualification. No dependency edge or
negative authority assertion was waived.
The one cancellation is the original moved public-package env-shebang consumer's
unchanged 10-second timeout (observed 11.72 seconds). Its isolated control result
passes unchanged: one case, zero skips/TODOs, 3.12 seconds for the case and 3.71
seconds total, exit 0. This supports contention as the timeout cause but does
not clear the failed broad gate. No timeout or fixture was changed.
Earlier attempts are not passes: overlapping build closures removed compiled
safe-js inputs during the first seven focused shell test imports; the remainder
of that run had 1,987 passes and two TODOs. An initial broad unit attempt was
interrupted; another ran during the intentionally failing activated csvcut TDD
regression and was also interrupted. The initial guarded lint run returned
status 2 for 190 directory-identity gaps during builds, with zero reported code
errors and two warnings. Its incomplete receipt is not a clean lint gate.

Complete numeric/null operation-cell contracts, Agate Table objects, exhaustive
source-test mapping, separately qualified TTY/IPython/driver/service profiles,
verbose traceback provenance and five alternative stdout-encoding TODOs remain
explicit compatibility blockers. A matching version/help, supported refusal,
mock capability or narrow regression suite does not clear them. No README
content, staging, commits, pushes or publication are authorized by this review.
