# Configurable text and distinct CSV QA

Use only the separately built Gnumeric 1.12.61 oracle in the isolated Colima
container. Verify the official archive SHA-256 before consulting source. Capture
version, library versions, installed plugin hashes, locale availability and the
explicit HOME/XDG/GSettings environment under `out/configurable-text-export`.
Primary source stays in `out`; never call native tools from unit tests or product.

Before implementation, run the in-memory regression proving unavailable writers.
Measure original small workbook fixtures with text, numeric formatting, empty
cells, ragged rows and multiple sheets. Compare output bytes, diagnostics, status
and destination effects for defaults, selection, every accepted option, enum and
boolean failures, excluded formulas and unsupported import-options. Exercise
multi-character quotes/separators, fixed quoting triggers, whitespace, newlines,
empty ranges, charset conversion, locale and duplicate selected sheets.

Implement in the ssconvert package, using the existing SDK/command engine and
injected I/O. Unit file changes use memfs. Run package tests/lint and the maintained
uncached workspace build closure for safe-bash. Verify virtual command behavior,
cancellation and byte budgets. Have a different agent stress and fix the finished
writer without changing root exports, integration ownership or Git. Record exact
verified coverage and remaining mismatches; unavailable cases are not passes.
## Executed checks and replay procedure

Invoke the native binary in `ssconvert-statistics-qa` via Colima's explicit socket,
using the environment in `docs/ssconvert/configurable-text-export-profile.json`.
Use fresh isolated HOME/XDG roots under a new owned `out` directory. Generate small
original workbook/CSV fixtures, ensure multi-sheet Gnumeric XML has an explicit
UTF-8 declaration and consistent SheetNameIndex, and preserve any rejected fixture
captures beside corrected captures until summarizing. The first exploratory fixture
was rejected because both prerequisites were missing; those captures were not passes.

Compare the option cases and original Unicode fixture with the source SDK engine;
compare independent charset cohorts through both runCommand and owned SDK workbooks.
For non-ASCII CLI arguments under C, capture native invoked through PATH as
`ssconvert` as well as absolute oracle invocation so argv[0] diagnostics remain
distinguishable without normalization. Keep all comparisons explicit: statuses,
destination bytes and stderr are three separate assertions.

Run `npm run test --workspace=@poe-code/ssconvert` and
`npm run lint --workspace=@poe-code/ssconvert` fresh; run
`npm run build:workspaces -- --workspace=@poe-platform/safe-bash --no-cache`.
Run the two `packages/safe-bash/tests/commands/ssconvert*.test.ts` files with Node's
tsx test runner, `npm run test:runner --workspace=@poe-platform/safe-bash`, and the
maintained `npm run typecheck --workspace=@poe-platform/safe-bash`. The maintained
typecheck currently rejects the missing root shared SafeFS export prerequisite;
do not alter unrelated manifest edits or report that route as passed.

For manual screenshots use `npx tsx scripts/screenshot.ts --output <owned-out-png>
-- node <temporary-public-virtual-command-host> '<ssconvert command>'`. Bind empty
codecs to the real product import/export engine, inject a MemoryFileSystem holding
`name,value` and `"a,b",1.20`, capture `ssconvert --list-exporters` and configurable
`separator='||' format=preserve` export to fd://1, and inspect both images. Remove
the temporary host and images after recording observations. This manual host is
an invocation fixture; the QA procedure is this Markdown document.

See `docs/ssconvert/configurable-text-export-verification.md` and the accompanying
profile/coverage JSON for verified scope, independent repairs and remaining limits.
