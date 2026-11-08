# Formula move identity QA

Tracking: hey-boss #3556, within the open #1748 qualification goal.

1. Read pinned Calc `token.cxx:4564-4605` at
   `bce0998afefdbc355585ca324285661a2170ba77`. Confirm that moves resolve
   local and external references at the old origin before rebasing them.
2. Run the maintained ssconvert package tests and lint. Cover sheet ID/name
   aliases in both directions, case folding, ID/name collisions, simultaneous
   renames, explicit names, external targets, ODF ranges, live label members,
   A1 copies, R1C1 moves and structural endpoint edits.
3. Build the selected ssconvert workspace closure. Import its compiled public
   entry point. Create a memory workbook with Local/Remote/Other sheets and
   distinct values. Parse a formula using Local's ID, move using its display
   name, and confirm unchanged source spelling and recalculated target values.
4. Move the same formula to Other; independently inspect its qualifiers and
   recalculate. Copy it to Other and confirm destination-local references use
   destination values. Exercise ODF relative-sheet copies using display-name
   positions. Check R1C1 offsets still change for moves.
5. Verify an ID rename affects implicit references qualified by a cross-sheet
   move, explicit local references and local names. External references must
   preserve their source workbook. With an ID/display-name collision, select
   the other sheet by its unique ID and check the original target survives.
6. Commit explicit source/test/document paths, verify remote-main ancestry,
   and follow the containing GitHub release through publication. Record compact
   evidence in the gap ledger and hey-boss; purge consumed temporary logs.

This SDK reference-editing change adds no CLI option or visual layout. Full
native interoperability, format transport and release qualification remain
separate requirements of the parent plan.
