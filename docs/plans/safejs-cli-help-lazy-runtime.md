# CLI help without interpreter initialization

## Validated problem

The post-ZonedDateTime full package gate timed out importing cli.ts for help
(ba9a26). The unchanged five-file rerun passed 1,065 tests and failed only the
two native Promise property expectations (897397); timeout non-recurrence is
not a repair. The full gate remains failing.

An esbuild import-graph inspection (3276ef) found eight eager routes from cli.ts
to interpreter globals through runtime lint bindings, filesystem/MCP/harness
modules, restore, run, snapshot dumping and migration. The graph contained 336
local input modules. Help does not need these execution paths.

The new cli-help-import regression prevents interpreter-global initialization
and requests normal help. Before the change it hit the five-second timeout
(4e973b). After lazy runtime loading, the help/entrypoint selection passed all
12 tests (6e3e02), including the explicit assertion that globals were not loaded.

## Implementation

Execution-only modules now load inside runScriptFile; migration loads only when
requested. Default runtime assembly loads its filesystem and harness factories
when needed. Help keeps the existing parsing/output behavior and aliases.
Signal snapshot capture receives the already-loaded dumpCurrent function so
the handler does not gain an asynchronous import before capturing its snapshot.

The first wider run exposed a fixed-microtask-count SIGINT test race (09cc11).
The test now waits for its host wait call to be entered before sending SIGINT,
preserving the intended suspended-call/finally/snapshot assertions without
depending on import scheduling. No timeout ceiling or coverage was removed.

## Verification

- CLI, entrypoint, help, filesystem config, dynamic source, and PPR2 signal/
  replay selection: 111 tests passed (eaeae5), including migration coverage.
- Node 18.18.2 help/entrypoint selection: 12 passed (93803d).
- TypeScript passed after the signal capture adjustment (4e25de).
- Fresh static import traversal: 60 eager local modules, no interpreter globals
  reachable by eager imports (5f2bc5). This is not an end-to-end latency benchmark.
- Source CLI help screenshot (0fc906) was visually inspected; help, aliases,
  options and exit codes remain readable and unchanged.
- Whitespace checks passed (74dbf1); final scoped lint passed without warnings
  after removing the obsolete helper (f41a13).
- Maintained build passed all 23 tasks and five fresh ESM checks (8fbeaf).
- Built CLI help passed on Node 18.18.2 (a1f51f); built script execution retained
  the expected DST day total of 23 hours (9d4753).

The obsolete fixed-microtask helper was removed after lint identified it as
unused. This change does not resolve the remaining full-gate Promise policy or replay/projection/regex
performance findings, and it has not been pushed or released.

## Template-cache import regression

The post-source-identity package gate reproduced a new eager import route:
CLI → Budget → template-objects → object-model → values → promise-replay →
snapshot validation → interpreter globals. The help-import test threw its
explicit "Help must not initialize the interpreter" error. A static import
traversal independently identified the path (7427a3).

Template cache ownership and cleanup now live in a module with type-only
dependencies. Budget and object-model import this cleanup directly; template
creation still records source and realm provenance. No lazy asynchronous
cleanup, generic callback registry, timeout increase or loss of template
identity was introduced.

The help-import regression and template/budget/mixed-source selection pass all
37 tests (0ca14c). Normal CLI and entrypoint coverage passes 57 tests (0f7665).
Scoped ESLint and package TypeScript checks pass (a36e33). The maintained build
passes all 23 workspace build tasks and five fresh native ESM import checks
(747a47). The source help screenshot (da4ce4) was visually inspected: usage,
options, aliases and exit codes remain readable and unchanged. This does not
resolve the other full-gate failures; releases remain on hold.
