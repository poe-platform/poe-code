# Host Promise settlement built-in admission

## Observed gaps

A read-only public `run()` probe on main f535553f4 (2d5c93) imported
`Promise.resolve(value)` through bindings and used the settled value:

- Native Map with `get("key")`: attempted to call a non-function value.
- Native Set with `has(7)`: attempted to call a non-function value.
- Native RegExp with `test("abc")`: unsupported sandbox value at root, RegExp.

These are distinct from Promise own-property metadata admission. No private
host metadata needs to be copied to preserve collection behavior.

## Current work

The Map/Set second-conversion repair is isolated in the Promise settlement
candidate described by `safejs-promise-settlement-alias.md`. It passed the
expanded public selection and is undergoing fixed-source snapshot verification.
Before atomic integration, retain coverage independent of Promise identity so
the collection conversion repair is not accidentally tied to alias-only cases.

RegExp is rejected at the host bridge, which currently has no RegExp admission
branch. This is an identified JavaScript interoperability limitation, not yet
a validated implementation proposal. Determine the intended host-value boundary
and reuse sandbox regex compilation ownership and quotas; never admit a native
regex as a bypass around the sandbox regex engine. Reproduce direct binding,
host function result, and Promise settlement routes with tests before changing
the implementation. Include repeated replay and budget rejection controls.

A second read-only probe (be3acf) confirmed that RegExp rejection occurs on all
three routes: direct binding, synchronous host return, and Promise settlement.
The reported error is the same unsupported root RegExp value. It is therefore
a shared host-bridge admission gap, not solely a Promise second-copy problem.

## Isolated RegExp reproduction

Candidate `/tmp/safejs-host-regexp.Fy6ub6` copies main runtime `c6e146fca`.
Its `src/run.host-regexp-import.test.ts` has three route regressions, all failing
with unsupported RegExp errors before any implementation (6e7b8c). They require
source, flags and initial cursor preservation, sandbox matching without changing
the original native cursor, and completed replay.

The existing `createSandboxRegex` path accepts a `CompileScope`; its parser
enforces source/flag lengths, compilation work and allocation limits. Reuse
that path with the operation's owner. Native source/flag extraction must use
intrinsic brand-checked getters rather than caller-shadowed accessors, and
second conversion of the sandbox regex must also retain its representation.
No candidate implementation has been added yet.

The candidate now imports native/internal sandbox regexes in the host bridge,
using intrinsic source and individual flag getters for native values and the
existing sandbox compiler with the operation owner. Own data descriptors are
copied recursively; accessor/symbol metadata is rejected rather than invoked.
Initial three-route replay/cursor tests passed (9d29ad), and TypeScript passed
(48d751). Added foreign-realm/inherited-shadow controls, accessor non-execution,
and source-length/compilation-step limits. Expanded verification is running;
main remains unchanged for session 50809.

The expanded initial selection passed 62 tests (f99921). A new frozen-state
regression then failed (17432a): the read-only cursor and self-reference were
preserved, but the imported object became extensible. The candidate now mirrors
non-extensibility onto the sandbox regex property storage after copying data
descriptors. Focused regex, Promise identity, and snapshot checks plus candidate
lint are running. No main runtime changes during the integration gate.
The selection passed 72 tests (750532) and lint passed (3e32de). A subsequent
read-only candidate probe found entry-point arguments and import.meta still
reject native RegExp (4251d7): those routes use the separate value-copy helper.
Do not claim complete public input support or integrate the host-bridge-only
candidate as the complete RegExp repair. Add regressions for these two paths
and share safe native-state extraction/compilation behavior before qualification.

Added both missing public routes to the candidate regression; they failed
before implementation (6407ae). Native source/flag extraction is now shared
through `interp/native-regexp.ts`. The value-copy regex branch admits native
regexes as well as sandbox regexes, and run supplies its compilation scope to
argument/import.meta copies. All five public routes passed; TypeScript passed
(2ceaf9). The value suite exposed its historical explicit RegExp rejection
expectation (e6c494), now replaced with a positive converted-state assertion
while preserving the remaining unsupported-value controls. Checks are rerunning.
That selection passed 71 tests (1b4a13). A later direct Promise-settlement
budget regression failed (bae57d): the value-copy Promise callback dropped its
compilation scope, allowing a 200-character regex under a 100-character limit.
The candidate now propagates compilation scope to both fulfillment and rejection
copying. The updated five-file selection, TypeScript, and lint are running.
The obsolete value-test title was also corrected to describe supported imports.
The updated selection passed 87 tests (ae909f), and TypeScript passed (348d7d).
A fixed-source candidate snapshot/regex/value/public-input qualification is now
running with JSON output `/tmp/safejs-host-regexp-candidate-results.json`.
Keep candidate runtime and tests unchanged until terminal; main separately
remains fixed for the Promise settlement integration gate.
The fixed-source candidate run is session 87047. Candidate lint also completed
successfully (42dfe5). Both this session and main session 50809 were confirmed
live during the subsequent audit; no terminal result has been recorded yet.

RegExp candidate session 87047 terminated (0d0e6a): 2,606 tests passed and one
failed across 178 files. The failure is the compile-ownership control expecting
an ordinary-object journal graph rather than a regex node. Inspect the fixture
and intended ownership assertion before changing it or the implementation.
The candidate remains unqualified; main runtime still excludes these changes.
Inspection showed the control supplied `createSandboxRegex`, not an ordinary
record. Its flattening expectation was stale under the new admitted type. The
control now requires a regex node and keeps all alias, immutable snapshot,
replay equality, and zero-provider-reissue assertions. The corrected control
and public RegExp selection passed 22 tests (7e058b). Only the test changed
after the broad run; record a refreshed qualification before integration.
Refreshed fixed-source qualification is running as session 21787 with output
`/tmp/safejs-host-regexp-candidate-qualified-results.json`. No RegExp candidate
runtime/test edits are permitted during this run.

Refreshed session 21787 terminated successfully (3694d7): all 2,607 tests passed
across 178 files. This includes the corrected compile-ownership control and all
eleven public import/state/budget cases. Candidate runtime stayed fixed for
the entire qualification. Final lint is being refreshed to include the updated
ownership test. Main remains fixed for session 50809, so this RegExp repair
has not yet been copied into the repository or committed.
Final lint including the updated ownership test passed (188478).

No main runtime or test source changed during the current integration gate.

After session 50809 terminated, transferred the eleven public regression tests
to main first. All eleven failed against unchanged runtime (e4c034), confirming
the unsupported import paths and missing compile-budget behavior. Transferred
the reviewed candidate runtime and corrected existing controls next. Main's
focused import, values, ownership, Promise identity and collection tests passed
59 tests across five files (a08aac); TypeScript passed (843fea). Maintained
workspace build and scoped lint are running before a local-only commit.
Both checks completed successfully: scoped lint (313c18), maintained build
with 23 declared build tasks and five built-import checks (baa9f3).
All seven transferred runtime/test files match the 2,607-test qualified
candidate byte for byte (4f513d). Main diff whitespace validation passed.
README now documents the import routes, bounded guest matching, copied state,
and host-bridge metadata restrictions. This is nonvisual runtime work.
The full main package gate remains red as recorded in the integration plan;
these focused results do not claim to resolve those fifteen failures.
