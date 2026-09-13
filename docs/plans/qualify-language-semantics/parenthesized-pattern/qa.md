# Parenthesized destructuring target QA

1. Run the new independent parser, native syntax and eval/replay regression before
   repair. Record the failing assertions and valid grouping controls.
2. Add only the parenthesized literal early-error check. Run the ten selected
   parser, destructuring and generator test files plus scoped ESLint and maintained
   SafeJS build closure. Keep budgets, deadlines and assertions unchanged.
3. Run the six ledger-selected Test262 files in their original strict/sloppy
   Script contexts. Verify each fixture hash and mode against the recorded cases
   and their recorded neighboring controls; retain all aborted attempts.
4. Run built SDK native/syntax, eval side-effect, source identity, three pending
   checkpoint cycles, completed replay, host-constructor escape and step-budget
   controls on available Node runtimes and Bun. Record exact runtime/ICU versions.
5. Capture the built CLI on `invalid.ajs`, inspect its terminal image and compare
   the error name, message and location to the SDK.
6. Independently extract HEAD and apply only the owned repair and regression;
   restore maintained setup inputs without changing tests or lint policy. Verify
   all selected tests, original upstream contexts and scoped lint on the exact
   parser/test bytes to be committed. Commit only owned evidence and source.
