# Weak-state retained-data accounting reconciliation

## Scope

Commit the existing weak/finalization accounting additions in measureSandboxData
with their weak-collection regression tests and new held-value controls. No
runtime accounting code changes during this reconciliation. Do not include
Temporal fields, Intl requested-options accounting or copy/snapshot changes.

Weak-map values contribute only after both the owner and key are independently
reachable. A worklist allows newly reachable values to expose additional keys
or owners without allowing unrooted weak cycles to activate themselves. Weak
sets charge active membership. Permanently reachable well-known symbol keys
are handled explicitly. Expired index references are removed during inspection.

Finalization accounting retains the guest callback and held values plus cell
overhead, not target or unregister-token graphs. New tests verify this with
large target/token payloads, alias deduplication, held-value mutation, unregister
and disposal. No actual GC timing is required by these checks.

## Verification

- Node 22: 35 tests pass across weak-collection accounting, held-value accounting,
  well-known symbols, index cleanup and deterministic finalization state.
- Node 18.18.2: both new held-value accounting tests pass. Arbitrary weak-symbol
  support is not qualified by this run and remains host-dependent.
- Package TypeScript no-emit checking passes.
- Focused lint passes. The existing four-file value/retained-root cohort passes
  all 77 tests.

Some selected well-known-symbol and index-cleanup cases exercise uncommitted
public/snapshot integration; they are working-tree evidence, not proof that
all integration is present in this commit. Full-suite failures remain open.
Preserve unrelated values.ts and staged Safe Bash changes. Local commit only
under the release hold; no push, publication or issue closure.
