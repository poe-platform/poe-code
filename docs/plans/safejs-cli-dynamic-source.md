# Dynamic source through the CLI lint gate

## Validated gaps

The injected-IO CLI probe returned exit 2 and AS001 for guest `Function`.
Six regression cases reproduced AS001 for constructors, direct/indirect eval,
nested eval, and guest-only host-global visibility. Removing the stale ban
exposed AS003 because both runtime globals were absent from lint declarations.
Direct eval also produced an incorrect AS007 unread-binding warning.

## Changes

Remove only Function/eval from AS001; strict module `with` remains rejected.
Declare both guest runtime globals for identifier and shadow analysis.
Treat bindings visible to a potentially direct eval call as potentially read;
retain warnings for shadowed outer bindings, indirect/optional eval, constructors,
and argumentless calls. No host evaluator or runtime permission was added.
Update the older rejection expectations to guest-runtime acceptance, keeping
their source-position coverage and separate strict-module rejection controls.

## Evidence

- Candidate session 35414: six AS001 failures before changes.
- Candidate session 54413: AS003 failures after removing AS001 restrictions.
- Candidate session 19597: five direct-eval binding failures and four controls.
- Main session 57076: all 15 new CLI/binding tests passed.
- Candidate session 68778: 606 passed, two stale syntax-parity expectations
  failed; these expectations were subsequently updated, not suppressed.
- Screenshot `/tmp/safejs-cli-dynamic-source.png`: inspected the normal CLI
  JSON result `{"ok":true,"returnValue":3}` from nested Function/eval.
- Candidate session 3048: all 608 lint/CLI-focused tests passed across 46 files.
- Main session 98342: TypeScript and seven-file scoped ESLint passed.
- Main session 68713: final syntax-parity test lint and whitespace checks passed.
- Maintained candidate full gate 8302 is running; no full-candidate pass is
  claimed yet.

The implementation was prepared in the isolated dynamic-source candidate
while main session 74273 ran. It was copied to main only after that full run
terminated. It depends on the uncommitted dynamic-source runtime; include it
with that feature before claiming complete CLI/SDK delivery. No push/release.
