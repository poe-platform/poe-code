# Additional table edge validation — 2026-09-18

This review covers supported Number/Text inference and actual safe-bash command
execution. It does not qualify the full csvkit suite or every possible edge case.
The reference used CPython 3.14.2, csvkit 2.2.0 and Agate 1.14.2 installed from
the existing hash-pinned runtime lock under C locale, UTC and UTF-8 stdio.

## Confirmed corrections

Two original in-memory regressions failed before engine changes:

- Quiet NaN multiplication under precision 28 retains only the last 28 payload
  digits, then removes leading zeros. For example,
  `NaN123456789012345678901234567890123` becomes
  `NaN6789012345678901234567890123`; a payload of one followed by 28 zeros
  becomes plain `NaN`.
- Agate strips an outer minus before Decimal parsing. A remaining minus on
  a quiet NaN operand survives multiplication: `--NaN123` becomes `-NaN123`,
  whereas `-NaN123` becomes `NaN123`.

365 development-only differential Number/Text cases all match after these
corrections. Cases combine signs, coefficients, exponent forms, rounding ties,
NaN, infinities, rejected tokens, currency, grouping, underscores and nulls.
Canonical tests embed expectations and never execute Python or create files.

## Independent command review

A separate agent authored `csvkit-table-extra-edge.test.ts` and reproduced the
NaN failure through actual safe-bash registration before rebuilding the engine.
Its three tests now pass, comparing exact stdout, stderr and status, with VFS
preservation checks. They cover NaN precision/sign, signed/scaled zero,
no-inference Text null policy, repeated ordinary-store null options, operand
consumption, custom-null whitespace, `--blanks`, and later excess-row failure
without partial output. Independent scoped ESLint passed.

## Verification

- csvkit workspace lint: exit 0, including both production/test type checks.
- csvkit workspace test: 30 files; 1605 passes and five existing encoding todos.
- Maintained selected workspace build: exit 0; office-package/csvkit closure,
  uncached.
- All safe-bash csvkit command tests: 137 passes, no skips or todos, exit 0.
- Actual registered `csvformat -U 2` output captured through the maintained
  screenshot route and visually inspected; payload, sign and zero scale were
  legible. The adapter, screenshot, reference venv, probe JSON and run log were
  stored in out and purged after use.

## Remaining boundaries

TimeDelta/Date/DateTime parsing, explicit temporal formats, header warnings,
other Number locales and broader typed command paths remain explicit blockers.
The absent-header input `\n1\n` was confirmed to have source warning/output
behavior; the engine still explicitly refuses that case. Encoding todos and
unmeasured database/network/interactive behavior are not passes. No full-root
gate or release qualification is claimed. No README edits, staging, commits,
pushes or publishing were performed; unrelated changes were preserved.
