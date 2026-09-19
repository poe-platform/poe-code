# Table inference validation — 2026-09-18

Scope: new typed table engine, csvformat QUOTE_NONNUMERIC, and measured
Boolean/Number csvsort paths. The full suite request remains unfinished.
See `docs/specs/csvkit-table-inference.md` for implementation boundaries and
`docs/plans/csvkit-table-inference-qa.md` for the agent QA procedure.

## Verification

- `npm run lint --workspace=@poe-code/csvkit`: exit 0, including source ESLint,
  production type checking and canonical test type checking.
- `npm run test --workspace=@poe-code/csvkit`: exit 0; 30 files, 1603 passes,
  five existing encoding todos. Todos are unqualified, not passes.
- `npm run build:workspaces -- --workspace=@poe-code/csvkit`: exit 0;
  declaration-derived selected build closure includes office-package and csvkit.
  No caching was enabled.
- `node --import tsx --test packages/safe-bash/tests/commands/csvkit*.test.ts`:
  exit 0; 134 passes, no skips/todos.
- Independent ESLint for the two reviewed safe-bash test files: exit 0.
- Actual Shell registration screenshots for `csvformat -U 2` and
  `csvsort -y 0`: captured through the maintained generic screenshot route,
  inspected visually; exact quoting, scale, sorting and null rows were legible.
  This is a Shell SDK host capture, not a root poe-code CLI command. Temporary
  adapter, screenshot and focused log were kept in out and purged after use.

## Independent review

A different agent authored and stressed
`packages/safe-bash/tests/commands/csvkit-table-stress.test.ts`. Six tests
cover exact command bytes/status, VFS preservation, fragmented producer
failure/cleanup, null option consumption, measured typed sorting and an
explicit mixed numeric/text inference blocker. Source-only probes validated
121 Decimal comparison pairs; no comparator mutation was necessary.

The reviewer reproduced the original U2 blocker, then the quiet-NaN blocker.
Root corrected both after red regressions. The reviewer updated only the
obsolete U2 blocker entry in the existing writer stress test to source-probed
supported output, preserving the remaining blocked writer cases.

Sorting probes included negative and scientific values, equal-scale stable
ties, signed zeros, infinities, null reversal, numeric ignore-case, and
no-inference text ordering. Numeric/Text mixed default tables were explicitly
kept blocked rather than demoting unimplemented temporal candidates to Text.

## Delivery and remaining work

No staging, commits, pushes, releases or README edits. Root package metadata
and unrelated edits were preserved. Verification is limited to the focused
package and existing safe-bash csvkit integration tests; no full-root lint,
full-root unit run, broad safe-bash build or release qualification is claimed.

TimeDelta/Date/DateTime casts, explicit temporal format casting, warning
provenance/filtering for duplicate/missing/absent headers, other Number
locales, broader Decimal trap/underflow qualification and remaining typed
commands are still blockers. Existing unrelated encoding todos and unmeasured
filesystem/network/database/interactive cases do not become qualified here.
