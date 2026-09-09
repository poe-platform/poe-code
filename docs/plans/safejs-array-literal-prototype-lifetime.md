# Array literal prototype lifetime

At d84140dc9, seven tests fail: empty, populated, sparse, spread, and nested
array literals lose their originating prototype after run cleanup; later
prototype mutation is lost; and an exported closure cannot create a new literal
with its originating prototype after cleanup. An explicit-null control passes.

Attach the initial prototype when evaluating a new array literal. Do not
overwrite restored generator expression state. Keep the existing array fallback
under its weak Budget key for live exported closures. This is a revision to the
earlier assumption that every realm lookup must disappear at cleanup: a live
closure needs its realm's array prototype to create new literals correctly.
It does not retain all run lookup tables. Retained accounting roots are still
removed, and the fallback becomes collectible with its budget key. The custom
iterator test additionally reproduced missing generator prototypes when a live
SDK closure creates a generator function after cleanup. Keep that weak-keyed
prototype lookup as well so the guest override remains executable.

Follow-up tests check pristine data copying/replay, post-cleanup prototype
mutation rejection, realm separation, explicit null, and a later custom guest
iterator override against an isolated native realm. A direct cleanup test checks
that accounting roots are removed while live budgets resolve their own arrays;
budget-free unlinked arrays still have no guest prototype. This test verifies
accounting and lookup isolation, not actual GC timing.

The initial eight cases pass, and SDK Iterator.from now accepts array and typed
array inputs after cleanup. Primitive strings still fail. The direct cleanup
test also passes. The first broader 237-file run finished with 4,300 passing and
38 failing tests. Besides the new generator-override case, the failures exposed
an incorrect explicit-null link in interpreter configurations without installed
globals. In that configuration, leave new arrays unlinked so existing array
support remains available; do not confuse a missing realm with an explicit guest
Object.setPrototypeOf(value, null) operation.

After guarding that case and keeping the generator fallback, 68 tests across
four files passed, including all ten new tests. The 257-file rerun finished with
4,742 tests passing and only the known unresolved primitive-string case failing
(147.56 seconds). All other 256 files passed. Final scoped ESLint and package
TypeScript passed; the maintained workspace closure passed 23 builds and four
fresh-process import checks. An unused import warning was removed and ESLint
rerun successfully. This change does not
claim to attach explicit links to every Array constructor, method-result, or
host-import creation path.

A full package unit run will follow these focused checks. Source/test SHA256
before that run is 050bed3034f56f289aeee70e25914e3e61d30145c61ec0ad5fbc2e76f24d3226.
This digest covers paths and contents under safe-js/src and safe-js/test only,
not build tools or dependencies. It includes the existing uncommitted work;
it is not an isolated committed candidate.

No CLI presentation change. README update authorized. Pushes and releases paused.
