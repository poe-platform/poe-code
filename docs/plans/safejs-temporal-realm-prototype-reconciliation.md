# Temporal receiving-realm prototype lookup

## Evidence

The object-model implementation pending at `f78aeaf01` adds receiving-realm
prototype lookup for all eight raw owned Temporal brands. Evaluating the
committed object-model module in memory with current value/realm imports returns
null for an owned Instant despite a registered receiving-realm Instant prototype.
No worktree files were reverted for this comparison.

## Integration boundary

Commit the eight Temporal brand imports, realm-table lookup and raw-value state
classification. Explicit prototypes are checked before the default lookup;
objects with materialized guest state retain that state. Leave the separate
intrinsic-prototype parent installation change uncommitted.

Eight independent tests exercise each Temporal type against two receiving
budgets, an absent realm, explicit custom prototypes and explicit null
prototypes. These use owned allocation and realm registration directly, avoiding
an assumption that success in one public run proves cross-realm behavior.

## Verification

- 275 tests pass across the new realm checks, four host-copy test files and
  the Temporal snapshot/replay cohort on Node 22.
- Focused ESLint passes.
- Node 18.20.8: all 27 realm and host-copy checks pass across five files.
- SafeJS TypeScript no-emit check passes.

Tests run against the current worktree; this is not a full clean-tree or package
gate. Broader realm qualification and weak serialization remain incomplete.

## Adjacent audit

The constructor-dispatch audit also found an iterator protocol bridge that does
not forward an explicit newTarget. No user-visible failure has been reproduced
for that path, so no speculative change is included.

Local integration only. Pushes and releases remain paused.
