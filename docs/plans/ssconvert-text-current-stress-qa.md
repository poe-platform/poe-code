# Current text importer independent stress QA

This procedure was executed by a different agent from the integration owner on
2026-09-20 against the live worktree. It qualifies the scoped text importer
changes, not an immutable committed candidate or complete native parity.

## Reference and procedure

1. Inspect retained Gnumeric 1.12.61 `src/stf-parse.c` and
   `src/number-match.c` under `out/ssconvert-lifecycle`, independently of the
   implementation. The requested official archive SHA-256 is
   `2ac135d856572713c1a408b76b50a59f2a9769ed21f1213446b5af255df20a12`.
2. Exercise original small in-memory fixtures through `readText`, including
   negative controls and valid nearby inputs. No unit test writes files,
   launches an oracle, or invokes an LLM.
3. Demonstrate each defect with failing tests before editing code.
4. Run the maintained package unit route uncached, package lint/type checks,
   and explicitly selected workspace build uncached. Integration, exports,
   CLI/screenshots and Git remain owned by the root agent.

## Findings and fixes

- `(+12)`, `(-12)`, `(12+)`, `(12-)`, and `(12%)` incorrectly became
  numbers. All five original cases failed before the fix. The stable decimal
  matcher establishes the sign on opening parentheses and rejects a second
  leading/trailing sign; it also rejects percentages with parentheses.
  The implementation now preserves those malformed accounting records as text.
  Positive controls `(12)`, `($12)`, `12-`, and `12%` continue to infer numbers.
- A mixed column `heading`, `1.234`, `not-number` under `de_DE.UTF-8`
  incorrectly inferred `1.234` rather than `1234`. The regression failed
  before the fix. A locale-aware decimal result was being discarded whenever
  earlier C-locale inference had already returned a number. The numeric value
  now comes from the locale-aware matcher, preserving the existing format.
  The independent C-locale control continues to produce `1.234`.

## Executed results

- Initial regression: five accounting failures and four positive controls pass.
- Second regression: German locale case fails; C locale control passes.
- Final focused uncached text suites: 4 files, 64 tests pass.
- Maintained uncached package unit route
  `npm run test --workspace=@poe-code/ssconvert -- --no-cache`:
  131 files, 3440 tests pass; completed in 13.90 seconds.
- `npm run lint --workspace=@poe-code/ssconvert`: pass, including ESLint,
  product TypeScript and test TypeScript checking.
- `npm run build:workspaces -- --workspace=@poe-code/ssconvert --no-cache`:
  pass, one selected package build executed.

## Limits and unavailable cells

Native Docker/oracle execution was unavailable in this review. The new
expectations are source-derived semantic checks, not newly measured native
differentials. The native dependency/plugin/locale profile and mapped upstream
runtime variants remain unverified by this reviewer. No performance
measurement, cross-realm execution, original/checkpoint/replay execution,
rollback/authority control, screenshot, or frozen candidate gate was run here.
The package route contains existing CLI/SDK checks, but does not establish a
Safe Bash integration gate. Locale date names, currencies, complete numeric
grammar, every iconv encoding alias, malformed UTF-7/UTF-32 variants and long
row performance were not exhaustively measured. These cells are unverified,
not passes. No additional concrete mismatch was claimed as fixed without a
failing regression.
