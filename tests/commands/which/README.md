# Which author regressions

These are implementation-author controls, not independent review. The separate
28-family freeze remains owned by Poincare; no hidden fixture expectations were
read to author these tests. Its public summary and manifest metadata were read,
and the listed cohort files were verified by hashes only.

Run the focused current tests without modifying evidence:

```sh
node --import tsx --test tests/commands/which/*.test.ts
```

Run explicit isolated validation:

```sh
node tests/commands/which/verify-isolated.mjs --capture
```

The latter captures a unique OS-temporary snapshot of the actual TypeScript
closure, exact package/config inputs and author harness inputs. It uses only
existing development tools, checks source and author tests, builds isolated
declarations/JS, moves compiled output into a directory without source, checks a
strict direct-module consumer and runs guarded compiled runtime controls. No
shared `dist`, main configuration, package metadata or dependency is modified.
The harness prints its temporary receipt location and retains failures. It does
not automatically write or replace committed evidence; explicit retained receipts
belong under `evidence/` and are non-TypeScript captured data.

`consumer.ts.data` is an input template, not canonical TypeScript source. During
explicit capture it becomes the strict consumer in the isolated moved tree.
`moved-runtime.mjs` is similarly copied beside `dist`; it has no live/source
fallback and is not a package-export claim. The runtime load hook hashes and
allowlists only compiled JS plus that copied driver. Input postchecks rehash
enumerated snapshot files and do not claim append-proof tree integrity.

The author suite exercises actual Memory, ReadOnly(Memory), registry/Shell and
byte-pipeline behavior, plus structural provider and sink controls for limits,
ordering, errors, backpressure, byte ownership and exact cancellation. Structural
faults are not remote-provider service tests. No native oracle is qualified here.
