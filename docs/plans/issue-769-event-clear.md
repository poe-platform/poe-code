# Issue 769: bounded event clear effects

## Validated scope

Current main ae1c98aaf shares the output/event implementation qualified in public
0.1.685. Pinned official CLI0.1.20 accepts console --clear and requests --clear;
the library registers both flags but ignores their effects. Public-installed
native runs reproduce retained old console entries and requests after clearing.
Full92-command/76-option inventory is evidence, not a new broad gate.

## Implementation and acceptance

Edit only capability-events.ts and the new playwright-event-clear.test.ts.
Clear the selected page's retained records through the existing eviction ledger;
do not leak quota or leave late response mappings. Reset request numbering and
console publication cursor/log state. Match the pinned empty structured result.
Keep other pages, observer ownership, cancellation and artifact bounds intact.
No storage/target/consumer edits; Franklin qualifies storage0.1.686 separately.

First capture public native red, then focused unit red before product edits.
Run new cases plus maintained capability-event/standard-capability tests and
scoped types only. Inspect an ad-hoc output screenshot. Commit only these three
owned files with --no-verify; root owns integration, push and release.
Evidence belongs in this worktree's out/issue769-inventory-459 directory.
