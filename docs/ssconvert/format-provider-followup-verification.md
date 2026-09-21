# Format provider registry follow-up verification

Executed September 19, 2026 against the existing dirty candidate. The declarative
registry and shared engine were already present when this turn began. Existing
implementation, integration and unrelated edits were preserved. This follow-up
adds independently specified filename, cancellation and budget controls; it does
not claim authorship of the pre-existing implementation or its recorded TDD cycle.
The original extension-only and shared-direction-ID failing regressions remain
documented in [the implementation record](format-provider-verification.md).

The [Markdown QA procedure](../plans/ssconvert-format-provider-registry-qa.md) was
executed for the available source, unit, built-command and screenshot cells.

## Primary source and corrected hypothesis

Fresh downloads and extraction stayed under `out/ssconvert-registry-audit`.
Gnumeric 1.12.61 authenticated to the required SHA-256
`2ac135d856572713c1a408b76b50a59f2a9769ed21f1213446b5af255df20a12`;
GOffice 0.10.61 authenticated to
`558597fd9ca59b93ff562750218d1e7ea8ec3c8d0ed6a5cc096aa715ef909a15`.
A separate XML census matched all 40 directional plugin IDs against the built
source register. The eight core registrations remain separately accounted for;
this census is an ID check, not fresh qualification of every metadata field.
The captured dependency/plugin/locale profile remains unchanged.

An initial Kelvin-sign regression expectation failed, but fresh primary source
disproved the expectation: GOffice plugin filename probes use `g_utf8_strdown`
at `goffice/app/go-plugin-service.c:636`. Core XML uses `g_ascii_strcasecmp`
at `src/xml-sax-read.c:3912–3920`. The speculative ASCII-only change was removed
before final verification. The corrected test checks native plugin folding and a
longer-suffix negative control. This was a harness error, not a validated product
failure or a product fix.

A different agent independently added 16 passing cases: mixed-case/Kelvin plugin
names; fullwidth, parent-directory, trailing-dot and basename controls; invalid
content for every name; four falsey/scalar cancellation reasons after awaited name
callbacks; five invalid byte budgets before callbacks; and foreign-realm reason
identity. No new validated implementation defect was found. Unit fixtures remain
in memory, with no native utility execution, LLM calls or real file writes.

## Final checks

| Check | Result |
| --- | --- |
| `npm run test --workspace=@poe-code/ssconvert -- --no-cache` | 133 passed, 12 files, zero skipped |
| `npm run lint --workspace=@poe-code/ssconvert` | Passed ESLint and production/test TypeScript |
| `npm run build:workspaces -- --workspace=@poe-platform/safe-bash --no-cache` | Passed selected 18-build dependency closure and postbuild |
| `npm run build:workspaces -- --workspace=@poe-code/ssconvert --no-cache` | Passed after Unicode restoration and final test additions |
| `node --import tsx --test packages/safe-bash/tests/commands/ssconvert.test.ts` | Eight passed, zero skipped |
| `node --test packages/safe-bash/scripts/integration-inputs.test.mjs` | 120 passed, zero skipped |
| Built public engine/virtual adapter manual terminal QA | Two listings returned 0; unknown exporter returned 2 before input read |
| Terminal screenshot | Captured and inspected; aligned columns, readable descriptions/diagnostics |
| `git diff --check` | Passed |

Screenshot SHA-256 before scratch cleanup:
`6439760f6dec4dd95e8fc04c425eb4a72d06bc252d4eecd8323ea76222f6d4ba`.
The fixture codecs in manual QA are explicitly injected original implementations,
not installed spreadsheet codecs or native format qualification.

Final 55-file dirty candidate manifest SHA-256:
`ee64f0d0f53ca9fa47d374eff6318d6d167fbd2457a1fdaa86fe796894afef2d`.
Membership and serialization follow the preceding implementation record: recursive
ssconvert source TypeScript, its package/two tsconfigs/provider generator, and the
Safe Bash ssconvert adapter/test; lexical POSIX paths; lowercase SHA-256, two
spaces, pathname and newline. This identifies source inputs, not a Git revision,
commit, complete root export inventory or release.

## Failures and unverified cells

The maintained Safe Bash typecheck exited 2 before source/consumer checking:
`Public SafeFS must preserve shared SafeJS runtime identity`, actual `undefined`,
expected `./packages/safe-js/dist/safe-fs.js`. Investigation located the binding
assertion in `tests/plugins/qualified-current-release/peer.mjs:245`; the current
root manifest lacks the required `./safe-fs` import. Related maintained negative
controls explicitly retain this missing-binding failure. No unrelated root export
edits were changed. This gate remains incomplete; package compilation does not
replace it.

No native oracle was executed in this follow-up. Fresh native dependency/plugin/
locale runtime cells, optional upstream variants, real format signatures/options,
performance measurements and checkpoint/replay remain unverified. All 48 built-in
directional services remain unavailable, truthfully absent from installed listings,
and recorded in [coverage](format-provider-coverage.json). The other semantic
mismatches in the preceding implementation record remain unresolved. Full parity
is blocked, not passed.

Repository-wide tests/lint/build were not run for these focused test additions;
selected cross-workspace checks do not imply completed broad gates. No checks were
timed out or interrupted. No README edits, commits, pushes or publication occurred.
Owned source, logs, script and screenshot scratch were purged after evidence
reduction; unrelated `out` content was preserved.
