# DU functional follow-up v1

Owned changes are the selected-environment fallback in DU, the empty-operand
diagnostic, and this new focused test/documentation/evidence subtree. Existing
author tests, `backends.test.ts`, `overlay-purity.test.ts`, `independent/**`, FS
providers, contracts, root exports and package metadata are outside this patch.

The historical classification was sealed first in commit `c288cfb0`, under
`evidence/classification-v1-20260827-9a7c34d4`. The three supplied report/raw/
validation files retain exact bytes; `SEAL.json` records their original paths,
hashes and pinned-source provenance. All original 15 differences and the three
new ordering differences remain present, including authentication limitations.

## Behavior

- O086/O087: select only the highest-priority own context environment property
  (`DU_BLOCK_SIZE`, `BLOCK_SIZE`, `BLOCKSIZE`). Empty/invalid selected formatting
  falls back to 1024, or 512 when own `POSIXLY_CORRECT` exists; do not consult a
  lower-priority variable. Explicit formatting continues to override environment.
- Explicit invalid `-B` still fails before FS calls. Environment size/work budget
  failures remain fatal; catching bounded parser UsageError does not catch those
  limits or caller cancellation. No allocation value or SIZE grammar is invented.
- Empty operands now report `du: invalid zero-length file name`, matching the
  measured native message. No empty/root lookup occurs, and later operands still
  run. Real and Memory's actual direct empty `lstat` rejection is also recorded;
  DU does not perform that FS call or relabel a real missing-path error.
- O060 remains unchanged and proposal-only; see `O060-PROPOSAL.md`. Child ordering
  remains deterministic rather than claiming GNU stream-order parity. The three
  frozen ordering gaps are retained, not fixed or waived.

`native-observations.json` is classified native fixture data: an exact copy of
the new 36-case controlled GNU9.7/Darwin capture, including raw errors, source
hashes, cwd, binary identity and direct adapter empty-path observations. It is
not a product byte pin. Canonical tests consume frozen native data read-only and
also run the actual pinned native binary against task-owned Real fixtures. If
the binary is unavailable that native test explicitly skips; BSD is not a substitute.

## Checks and capture

```
node --import tsx --test tests/commands/du/functional-v1/*.test.ts
node_modules/.bin/tsc -p tests/commands/du/functional-v1/tsconfig.json
node tests/commands/du/functional-v1/check.mjs
node --import tsx tests/commands/du/functional-v1/compare.mjs
```

Explicit capture writes unique versioned directories. Canonical tests never
rewrite evidence. Isolated build output stays under this subtree and is cleaned;
shared `dist` is not a build target. Source hashes and live git state qualify
author checks; original-path postchecks are not append-proof archive gates.
No public root/package DU import is claimed by built-module/plugin checks.

`check.mjs --owner-handoff` additionally runs only the relevant old author-test
names, read-only, to expose assertions needing their owner's migration. The
existing `behavior.test.ts` no-FS assertion for invalid environment and
`native.test.ts` strict O086/O087/old empty-name message conflict with the approved
behavior. They are not edited, skipped in canonical discovery, or relabeled as
current passing tests by this owner. Root must assign their migration; a green
new focused suite alone is not current full DU acceptance.

The first pre-patch run is preserved, including its backpressure-test wait that
could not be reached under strict environment rejection; the new test's wait was
made explicitly fail-fast without weakening the output-backpressure assertion.
Raw explicit-B diagnostic differences remain measured compatibility gaps.
Author results require separate review and integration, not automatic acceptance.
