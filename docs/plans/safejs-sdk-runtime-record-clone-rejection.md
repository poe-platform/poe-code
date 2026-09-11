# SDK structured-clone execution-backed records

## Validated gap

Five regression cases first verified guest structuredClone rejection, then
failed because the low-level structured-clone copy path accepted the same
values (df433e): Iterator.from wrappers, mapped iterator helpers, DisposableStack,
AsyncDisposableStack and arguments objects.

Use their existing private brands/state maps to reject them with DataCloneError
before ordinary record handling. Restrict the guard to structured-clone mode;
do not change ordinary copying, iterator execution or resource cleanup. Tests
cover direct and nested records and use the guest serializer as a consistency
control. Native engine availability is not assumed for newer constructors.

## Verification

- Node 22: 182 tests pass in the 17 filename-selected structured-clone files.
- Package TypeScript no-emit check passes.
- Node 18.18.2: all five new cases pass.
- Focused lint passes for values.ts and the new regression file.

This qualification is not full structured-clone conformance; weak-state and
capability boundaries, other copy behavior, the known full-suite failures and
uncommitted integration remain outside this fix. Only the four-line guard,
the regression file and this plan are staged. Other values.ts changes and
unrelated staged Safe Bash work remain intact. Local commit only under the
release hold; no push, publication or issue closure. No CLI appearance changes.
