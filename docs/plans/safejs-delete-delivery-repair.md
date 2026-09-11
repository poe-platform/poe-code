# Delete delivery repair

The working-tree deletion fixes passed their focused checks, but the selected
zero-context index patches retained offsets from unrelated unstaged changes.
The resulting commits inserted the value-expression block in the nullish-member
branch and the primitive-boxing line in an optional-call branch. Scoped release
34258998616 exposed the latter as an out-of-scope `target` TypeScript error.
Publication 0.1.485 does not prove the intended value-expression behavior.

An isolated checkout of committed source reproduces 12 failing value-expression
tests and 16 passing controls. Move the two blocks to their intended functions
without including any uncommitted dynamic-runtime changes. The repaired exact
candidate passes 94 deletion/member tests and package TypeScript checking.

Stage the complete verified candidate file by its Git blob identity, review the
resulting contextual diff against HEAD, and verify that the committed blob is
identical before pushing. Do not reuse offset-only partial insertion patches.
Keep lint, commit, remote delivery and release publication evidence separate.
