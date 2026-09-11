# Exception block declaration instantiation

Seven native strict-JavaScript cases failed before implementation. Try, catch
and finally blocks did not initialize function declarations before execution;
function assignments used an incorrect const binding; and class declarations
were absent rather than present in their temporal dead zone.

The exception evaluator maintained a separate variable-only declaration pass.
It now receives the normal interpreter's block-instantiation operation, applied
to the actual block scope. The duplicate incomplete pass was removed. Restored
generator block scopes are not re-instantiated, preserving captured identities.

Verification:

- Initial runtime/exception/eval-function selection: 57 passes.
- Existing generator/catch/block/class snapshot regression selection: 56 passes.
- Targeted runtime plus three new suspended-generator restoration cases: ten
  passes, covering try, catch and finally.
- TypeScript, focused lint and whitespace checks pass.

The first whole-SafeJS snapshot, 94065, excluded this work and finished with
22,631 passes, ten failures and 37 skips. The refreshed frozen snapshot in
session 31057 includes the implementation and original ten regression cases;
its build and import checks passed and its full unit suite finished with 22,682
passes, two host-promise property-import failures and 37 skips.
Three later identity-preservation recovery cases are outside that frozen run.

For the atomic local commit, isolate the repair from eval and the later catch
ReferenceError changes. All ten original runtime/recovery regressions fail
against committed HEAD 620ec0eac. With only this repair applied, 518 focused
interpreter, exception and ReferenceError delivery/recovery checks pass in the
isolated checkout. Do not treat these focused results as a full-suite pass.
The isolated implementation passes TypeScript and focused repository-configured
lint. After adding the three identity-preservation cases, all 13 targeted native
and recovery checks pass in both the main and isolated worktrees. The added
cases change only the source-string test matrix, not the checked implementation.
No push or release.
