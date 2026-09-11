# SDK Iterator.from Proxy operations

Following the separate internal iterator-adapter observation, five supported
SDK Iterator.from tests failed against native controls: Proxy iterable inputs,
Proxy iterator factories, direct/inherited Proxy iterators, and Proxy next
methods all lacked guest property context at reads, calls, or instance checks.

Create a shared local call context for Iterator.from and its wrapper next/return
methods. Use guest property access, preserve supplied context hooks, and forward
explicit newTarget. Replace the old descriptor-only read helper. Preserve
cached next, lazy return lookup, and original iterator receivers.

Seven focused cases pass, including a full native property-read/call trace,
replacement of next after wrapping, installation of a Proxy return method after
wrapping, and revocation before return. The unrelated internal no-budget adapter
observation is not claimed fixed. The broader iterator/iteration/generator
selection passed 1,575 tests across 61 files. Scoped ESLint and package
TypeScript passed. The maintained selected-workspace build passed all 23 declared
builds and four fresh-process import checks. These scoped checks do not replace
the full-package result recorded before this change (23,915 passed, two failed,
37 skipped).

README updated. No CLI presentation changes. No push or release during the hold.
