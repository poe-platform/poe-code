# Preserve collections in imported Promise settlements

## Validated failure

Main before this repair rejected Map/Set method calls after an imported Promise
settled. Three focused regressions failed with a non-function call error
(364d54): Map behavior, Set behavior, and shared/cyclic collection references.

The initial host conversion creates sandbox collections. Input journaling then
copies the fulfillment again, but the host bridge recognized only native Map
and Set and treated branded sandbox collections as ordinary records.

## Repair

Accept branded sandbox Map/Set in the existing recursive collection-copy
branches. Keep per-entry budget charging and the shared seen map, preserving
cycles and aliases. This change does not import Promise metadata or implement
the separately isolated Promise settlement identity/journal capability repair.

The new regressions require collection operations to work before and after
completed replay without re-supplying the original host input. The package
README is updated under the user's earlier authorization. No visual CLI output
changes, so screenshot validation is not applicable.

## Verification and delivery

Focused public Promise, host-call, and collection snapshot checks, TypeScript,
and lint are running. Record their terminal results before committing.
This repair postdates the full main gate documented in
`safejs-post-await-module-budget-integration.md`; that gate does not qualify it.
No push or release during the release hold.

The four-file main selection passed 69 tests (7e0643), and TypeScript passed
(c6675f). Main lint session 81120 and maintained selected-workspace build session
93023 remain live. The larger isolated candidate separately passed 2,363 tests
across 167 files, but it includes additional Promise changes and is not a
substitute for qualification of this independent main repair.

Main lint completed successfully (6a385c). The maintained selected-workspace
build completed 23 declared build tasks and all five built-import checks
(8bd2b5). The focused main checks qualify this atomic collection repair;
the earlier full main gate still predates it. Ready for a local-only commit.
