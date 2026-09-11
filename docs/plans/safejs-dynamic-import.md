# Dynamic import of registered modules

## Validated gap

On September 8, the built runtime rejects
`const module=await import('fixture');return module.value` with
`Unexpected token 'import' at line 1, column 20`, even when the caller registers
`modules: {fixture: {value: 7}}`. Static registered-module imports already exist.
The initial focused test file reproduced ten parse failures. The local candidate
now implements runtime evaluation and low-level snapshot restoration; public
replay integration remains incomplete.

## Required behavior

- Parse import expressions separately from import declarations and import.meta.
- Return a guest promise, preserving rejection behavior and expression ordering.
- Resolve only caller-registered modules. Do not introduce host Node imports,
  filesystem resolution, network loading, or new ambient capabilities.
- Reuse module namespace identity across static and dynamic imports and repeated
  dynamic imports, with existing host-operation wrapping and cancellation.
- Preserve module access and pending work through public snapshot/replay paths
  and closure/generator restoration. Do not hide an unserializable importer
  callback inside a scope.
- Validate computed specifiers, unknown modules, namespace descriptors, exported
  then behavior, and snapshot continuations with native controls where practical.
- Keep CLI/SDK behavior aligned through the existing runtime path.

## Integration points to inspect

`modules/registry.ts` normalizes caller modules and caches wrapped namespace
objects while binding static declarations. `run.ts` removes import declarations
when constructing the executable node. Dynamic imports need expression AST and
evaluation support and access to the same namespace cache. Before choosing
eager or lazy wrapping, check host-input observation order and snapshot policy;
do not assume all unreferenced module exports may be wrapped eagerly.

This is the next independent feature after verified global-object delivery.
Global-object support is now verified on remote main as 1bf69549f; its release
workflows are being monitored independently.

## Reference semantics

[EvaluateImportCall](https://tc39.es/ecma262/multipage/ecmascript-language-expressions.html#sec-evaluate-import-call)
evaluates the specifier expression and optional options expression before
creating the promise capability. Those evaluation errors remain synchronous.
String conversion happens afterward; its errors reject the returned promise.
Options validation and unsupported attributes also reject. Namespace resolution
uses the promise resolve operation, including exported then assimilation.
Added controls cover argument failure, trailing commas, undefined/null options
and options-expression effects before specifier string conversion.

Module access design remains under inspection: preserve current host-input
observation order and loaded namespace identity, and avoid eagerly wrapping
unreferenced exports merely to make snapshots easy.

The expanded focused baseline is 15 parse failures. Independent native data-URL
module probes confirm options effects before coercion, synchronous specifier
expression errors, rejected coercion errors, and exported-then assimilation.
The existing low-level snapshot RestoreOptions already accepts modules;
restoreModuleBindings rebuilds registered namespaces. ReplayInputs currently
captures only bindings, static imports, entry-point arguments and importMeta.
Coordinate any new dynamic module context with those existing restoration
paths instead of capturing a native importer function in guest scope frames.

## Parser candidate

ImportExpression now has source and optional options AST fields, with distinct
handling from declarations/import.meta and integration into await detection.
The parser baseline had five failures and five valid-rejection controls; after
implementation, the targeted parser/import.meta checks passed. A separate
labeled-import regression reproduced the old labeled-declaration rejection and
then passed after the grammar guard was narrowed. Direct new import calls are
rejected; parenthesized expressions remain ordinary constructor expressions.

The broader parser suite passed 823 tests with one existing skip, and the
focused parser/import.meta/async-lint group passed 49 cases. TypeScript no-emit
passed before the final type-barrel export, and source lint passed.
The feature candidate is intentionally uncommitted and unpushed until runtime,
snapshot and public replay integration are verified together.

## Runtime and low-level snapshot candidate, September 8

- The initial runtime/module-environment group passed 18 cases and TypeScript.
- Import options checks cover empty attributes, function options, rejected null
  attributes, unsupported attributes, all getter reads before string-value
  validation, ignored symbol keys and synchronous argument-expression errors.
- Exported then assimilation runs after the importing statement (24 runtime
  cases passed before the public replay case was added).
- Two failing closure round-trip tests demonstrated missing module access after
  restore. Scope frames now capture available module names and the shared loaded
  namespace cache. Restore attaches only explicitly supplied module backends.
  Repeated JSON round trips preserve loaded namespace identity and lazy access.
- Two failing generator tests demonstrated duplicate specifier evaluation when
  resuming inside options. A dynamic-import expression continuation now saves
  the evaluated source; wire encoding, decoding and AST-position validation
  preserve it. Sync and async generator round trips now pass.
- Invalid namespace references and duplicate module names are rejected by the
  strict snapshot validator. The five-file focused group passed 42 tests;
  TypeScript passed. The scoped source lint run passed before the final
  guest-AST-validator addition (that addition still needs lint).

## Public replay failure and correction

The public dump/replay test imports a module with mutable data and a host read,
mutates the data once, dumps the completed run and supplies a replacement host
read on restoration. It must preserve the original data input and replay the
recorded call without invoking either host function again. The baseline failed
with `Cannot update properties of null or undefined`: dynamic module inputs are
absent from ReplayInputs, so restoration uses the replacement registry's missing
data instead of the original input graph. This is a validated integration gap,
not a reason to weaken the test or eagerly wrap all unused module exports.

The local implementation now records each dynamically loaded namespace's input
graph separately, only when first loaded. Initial static namespaces share the
existing replay input graph with imported bindings. Restoration reuses that
cache, restores recorded dynamic inputs and rebinds explicit host capabilities.
It does not wrap exports of modules that were never loaded. Recorded data-only
modules can replay without a replacement registry; missing required host
capabilities remain errors.

A second red test caught distinct static/dynamic namespace identities on replay;
the shared restored cache corrects that. An exported-promise replay test, a
bounded failure checkpoint, cancellation and persistent-realm tests pass.
A budget regression initially observed only 63 retained units after a 10,000-unit
input was cleared by guest code. Module replay copies now have an explicit
retained budget owner and are released with the run. A forged ordinary object
in place of a namespace was initially accepted; replay validation now requires
the actual namespace brand.

The focused parser/runtime/replay group passed 70 tests. TypeScript and focused
source lint passed. The maintained 23-workspace build closure and four fresh
built-import checks passed, followed by a native Node 18 dynamic-import and
public-replay probe returning 7 twice. The full package suite is running with
source/tests frozen and the same two previously documented exclusions; it has
not yet established a passing release candidate.

The skill template now documents registered dynamic imports without claiming
ambient package/file/URL loading. Maintained skill sync updated six installations.
The Python skill validator could not run because PyYAML is unavailable; sync
success and the narrow reviewed template edit are the available validation.

## Remaining integration checks before delivery

- Built linter probes show `const key='fixture';await import(key)` incorrectly
  reports AS007, as does an options binding; nested unused declarations and
  floating import promises are missed. Add failing tests and extend affected
  expression visitors after the frozen suite finishes.
- Check that the execution-semantics guard treats module-input replay data like
  other modern replay sections, including adversarial missing-marker snapshots.
- Complete full regression review and downstream agent-harness checks, then
  commit/push this feature atomically and monitor publication independently.

## First full regression and follow-up

The first full package run finished in 444.71 seconds: 20,088 passed, four
failed and 38 existing skips. Three retained-root assertions exposed charging
the internal empty namespace-cache record as guest data. Scope retention now
exposes its actual namespace values, like binding values, without charging the
bookkeeping container. The unchanged accounting tests pass. The fourth failure
was the corpus's 750 ms wall-clock limit (843.3 ms); all its semantic checks
completed. Its unchanged focused rerun passed. No timeout, budget, fixture or
coverage reduction was made, and full verification is still required.

The linter and missing execution-marker tests reproduced 39 failures. Nineteen
expression visitors now inspect both import arguments; floating import promises
are recognized, and module replay data requires the same execution-semantics
marker as other modern replay data. The targeted group passed 89 cases, then
the complete lint/integration group passed 644 with one existing skip.
The obsolete skipped dynamic-import adversarial placeholder was replaced by
executed registered-module and no-ambient-loader assertions.

TypeScript and lint passed, and the maintained build passed again (23 workspace
builds and four fresh import checks). A second full package run is active with
source/tests frozen, retaining only the two original exclusions. Remote main
has advanced to 9b791fa88 with Safe-Bash-only changes; merge/rebase those without
altering the user's separate staged patch before delivery.

## Second full result and delivery audit findings

The second full run passed 20,136 tests with 37 existing skips, in 410.16 seconds.
All 677 active files passed. Source and tests remained frozen for that run.
The rebuilt Node 18 probe also passed replay, argument usage lint and floating
import-promise detection. Exported-then public replay returned 7 and left the
replacement host callback uncalled.

Two later checks prevent delivery despite that passing suite:

- The new low-level host-export closure test fails for both initially unloaded
  and already-loaded modules over repeated round trips. Once loaded, a namespace
  contains host closures whose native `.call` cannot be serialized. An explicit
  registered-module capability reference is needed, restored only through the
  caller's supplied registry, including property state and alias identity. Do
  not serialize native function bodies or broaden host authority.
- Maintained agent-harness tests passed 159 and failed four recovery cases.
  `initialInputs.moduleNamespaces` currently snapshots every export of statically
  loaded namespaces, requiring unused host exports on restoration. Previously
  named imports required only their imported capabilities. New source tests
  reproduce this with and without an unrelated dynamic import. Avoid a simple
  source-has-dynamic-import condition: it still over-captures unrelated modules.

The public replay input graph needs lazy extension when a namespace actually
becomes reachable, retaining aliases to already-captured named imports and their
original pre-execution data. Re-encoding the whole live graph after mutation
would capture the wrong initial state. Independent per-module blobs also need
care: they cannot duplicate named-import objects and lose aliases. A shared
incremental graph encoder/decoder identity context is a candidate design; test
alias preservation across mutation, promise inputs and replay before adopting it.
The existing replay-data encoder has a private seen map and node array; its
decoder has a private restored map. These are the integration points to inspect.

The shared codec foundation was delivered separately in `6386f35d3`, verified on
remote main. Fifty focused replay tests, ESLint and TypeScript checks passed.
`createReplayEncodingContext` shares nodes and object/symbol/backing-buffer IDs;
`encodeReplayData` accepts that context and a capability path prefix.
`decodeReplayData` accepts a graph-bound memo and publishes new identities only
after successful decoding. Failed graph extensions preserve completed roots and
invalidate the encoding context. The public input integration above remains
unchanged and its recovery failures are not yet fixed. Release publication for
the codec commit is not yet verified.

## Dormant namespace input integration

The local candidate now stores namespace roots in the shared `initialInputs`
graph, rather than eagerly restoring a `moduleNamespaces` property or keeping
independent `moduleInputs` graphs. Static namespaces are captured before guest
execution but decoded only on activation. Initial live identities seed the memo;
restored input identities populate it through decoding. Namespace promise inputs
are identified without starting their replay operation until activation.

`resolveModuleNamespace` prepares a cached static namespace once when its dynamic
view is requested. Recovery pre-registers supplied host exports without activating
the saved namespace; this preserves host-call journal validation without requiring
unused replacement capabilities. Completed run snapshots clone the shared graph
so later graph extension does not mutate an earlier checkpoint.

Both public unused-export regressions now pass. The focused module/registry/replay
group passed 88 tests; additional input tests verify dormant-promise behavior and
reject forged roots. A new red test exposed snapshot accessor evaluation by
cloning before validation; validation now precedes cloning and the test passes.
ESLint and TypeScript passed before the final two added test cases. The maintained
workspace build is running before downstream harness recovery is rechecked.
Low-level host-export closure snapshots remain a separate unresolved failure.

The maintained build completed successfully: 23 workspace builds and four fresh
native-ESM import checks. The downstream agent-harness suite then passed all 163
tests in 13 files (15.55 seconds), including all four previously failing recovery
cases. A rebuilt Node 18 probe returned `[true,true,1]` both originally and after
data-only replay with no replacement registry. Its first invocation accidentally
passed dump JSON text directly to `restore`; parsing that text corrected the
probe, not product code. This integration is still uncommitted pending low-level
host-export portability and full regression verification.

## Explicit module-function snapshot references

Low-level host-export round trips now pass using a `module-function` heap node.
The host bridge records origins only while wrapping explicitly registered module
exports; functions returned by host calls do not acquire that authority. Restore
resolves the module/path through the caller-supplied registry's capability table,
allocates the function identity before restoring its properties, and preserves
property cycles before the host-closure property object is frozen. Replay copies
also retain the origin metadata.

The focused snapshot group passed 18 cases, including repeated loaded/unloaded
closure round trips, cyclic properties, replacement callbacks, nested object,
array, Map and Set exports, forged identities, and rejection of arbitrary returned
host functions. Public dynamic-import tests also passed. Full regression and a
fresh build are still required after these source changes.

A separate current limitation was reproduced while writing the cycle test:
guest assignment to `namespace.read.extra` fails with `Assignment expressions
require a sandbox object property`. Native host-closure property records are
frozen. This change does not claim to add host-function property mutation; the
snapshot cycle test uses an already-present self-reference on the host export.

Codec commit `6386f35d3` scoped release job `34198716141` failed before the SafeJS
step, at SafeFS publication with npm E401 (`token is invalid`). The failed job was
rerun to obtain fresh trusted-publishing credentials. CLI job `34198716321` was
still running. Neither publication is claimed successful yet.

ESLint and TypeScript passed for the module-function implementation. The maintained
23-workspace build and all four fresh-process ESM import checks passed again.
Source and tests are frozen for downstream revalidation and the full SafeJS run;
retain only the two original untracked exploratory-test exclusions. Do not rebuild
dist or modify source during those runs.

The final downstream harness rerun passed all 163 tests in 13 files (21.32 seconds).
The full SafeJS run is active in execution session `46757`, with verbose log
`/var/folders/rw/s4cy76hn6v55qrp0dhcbtplc0000gn/T/safejs-dynamic-portable.5eotLc9KXp`.
Poll that existing session; do not restart it merely because an observation times
out. The source/test freeze remains in effect until its terminal result.

The scoped codec release retry succeeded: workflow `34198716141`, attempt 2,
published `@poe-platform/safe-js@0.1.438` at 2026-09-08T07:32:37.999Z. This is the
already-pushed shared-graph commit, not the uncommitted dynamic-import feature.
The CLI release was still running when that publication was verified.

## Final regression result

Session `46757` completed successfully: 20,161 tests passed, 37 existing tests
skipped, 678 active files passed and one file skipped, in 413.97 seconds. Source
and tests stayed frozen throughout. Only the two documented untracked future
experiments were excluded. The full-run freeze is now lifted; the candidate is
ready for final delivery checks and its atomic commit, not yet a completed push.

Final ESLint checks passed across every changed TypeScript file and all new test
files. A rebuilt Node 18 host-function snapshot probe restored an explicitly
supplied replacement and returned 11. Remote main was still `6386f35d3` at the
delivery check, and the user's staged Safe-Bash patch hash remained unchanged.
