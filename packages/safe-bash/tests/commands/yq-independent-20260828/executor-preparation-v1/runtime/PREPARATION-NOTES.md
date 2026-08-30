# Preparation attempt ledger

Date: August 28, 2026. No product candidate imported, built, typechecked or run.

1. Initial metadata read used a zsh loop variable named `path`, locally replacing
   PATH; subsequent `cat`/`rg` commands in that shell failed. A fresh read command
   succeeded. No files changed and no child controls ran.
2. Two exploratory reads named nonexistent `streaming.ts` and `freeze/index.json`;
   declared `command.ts`, `filesystem.ts`, `io.ts` and actual freeze data were
   then read. No substitute API was inferred.
3. First data-inventory generation failed before writing its outputs because
   the source ID was spelled `qb-readme` rather than the authenticated
   `qb-policy`. The generator was corrected and the 194-row inventory and
   selected source manifest were generated through `apply_patch`. This was a
   preparation bug, not a YQ failure or test result. No synthetic child ran.

The original protocol and synthetic fixture preseal is
`0f138190073cb5419aa86c63e0a10075fe67f88f`. Source harness and result seals are
recorded additively after checks. Historical frozen data remain unchanged.

4. First scoped validation: all 13 owned `.mjs` files passed Node syntax;
   `check-static.mjs` passed 194 IDs, eight overlays, 132 prepared projections
   and 149 variants. The original `PROTOCOL.md` write-spec check failed once
   because its H1 said “Protocol”, not “Specification” (one error, zero
   warnings). The shell did not use `set -e`; it intentionally proceeded to
   the separately presealed synthetic checks. That checker failure is not
   omitted from preparation status. `PROTOCOL-SPECIFICATION.md` supplies an
   additive heading-compatible entry without modifying the original protocol.
5. Source seal `d77e8714e9e6a97d689045f6dd66afafd5842a2d` ran all 15 presealed
   synthetic controls successfully. Their 14 intentionally failing cohorts
   stayed aggregate FAIL; the single normal-pass cohort stayed PASS. Every
   actual child was reaped; the reap-proof negative control intentionally
   withheld proof after actual reaping. Summary:
   `evidence/synthetic-summary-ca62c667-9e73-4dec-8518-5f15e172dcb5.json`.
   These are framework results only: zero YQ executions and semantic passes.
6. Pre-final source review tightened canonical receipt parsing to reject duplicate
   JSON keys, validated diagnostic source/coordinate framing, and authenticated
   the presealed control file modes. Three data-only receipt counterfixtures were
   sealed in `check-static.mjs` before the next run. These are framework controls,
   not added YQ policy cases. No original protocol/fixture/history was modified.
