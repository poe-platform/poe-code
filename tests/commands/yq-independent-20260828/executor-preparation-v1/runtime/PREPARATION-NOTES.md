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
