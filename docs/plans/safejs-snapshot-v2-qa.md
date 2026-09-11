---
title: SafeJS snapshot v2 QA
---

Run this harness through the CLI with a fresh snapshot path. Successful CLI runs
remove checkpoints by design. Run the same pair through `runHarnessPair` with
`preserveSnapshotOnSuccess: true`, `snapshotIntervalMs: -1`, and an empty
`modulesFor` registry to retain the checkpoint, then resume it through the CLI.
Inspect screenshots of the fresh and resumed CLI runs. Both must report the same
successful summary. This checks CLI integration, not independent low-level
generator restoration, which is covered by unit tests.

No agent spawns, network access or host-side effects are needed.
