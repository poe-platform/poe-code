# Actual execution protocol

This is the executable extension of preparation commit `9b72400`. The six
original preparation files remain immutable, including their zero observations.
`execution-cases.mjs` applies only the authorized pre-measurement corrections:
distinguishing unalias before/after behavior, hash-map-only attribution, preserved
printf status, one mode/symlink census control, and product-only sleep timing.
There are 61 primary recipes and seven direct-target diagnostics per engine.
Diagnostics never receive positive operational credit.

Run from the repository root with existing Node/tooling only:

```
node benchmarks/reports/baseline-only-20260827/coverage-execution/verify-execution.mjs
node benchmarks/reports/baseline-only-20260827/coverage-execution/run.mjs
```

The runner refuses an existing destination. The first attempt snapshots source into
an owned `/tmp` directory through apply_patch. The corrected attempt reuses exactly
that snapshot, never moving live source. Both hash the Node executable, complete installed
dependency trees, resolved optional assets, source and harness before starting any
product case. Source symlinks are rejected instead of following moving targets;
dependency links must stay within their audited tree. The root release is required.
All evidence text/JSON is published through apply_patch. No products are built,
installed, replaced or edited; no native reference command is used.

Each case/engine has a fresh process and memory filesystem. The host environment
is synthetic; Node and tsx resolve by frozen absolute paths, without PATH lookup.
The actual public Shell/agentCommands registry or Bash/kernel handles execution.
No new command definitions, native fallback, fake SafeJS or private runtime exist.
All three baseline optional runtime profiles use their documented settings and
local assets with 120-second product limits; ordinary calls use 30 seconds.
The outer child envelope includes separate setup/cleanup grace of ten seconds.
Any exceptional termination remains visible, never called normal exit.

Baseline curl uses documented SecureFetch injection with an exact URL/GET policy,
bounded Node HTTP transport and fixed local fixture. Ours uses networkCommands
with exact authorization and its existing default public transport. No external
fixture traffic, redirects or ambient network capability is authorized.

The complete root namespace is captured with lstat, no symlink traversal, raw
available metadata, file base64, symlink target and explicit census errors.
Missing fields stay absent. Census bounds are 4096 entries/depth32/32MiB.
Effects project only path/type/mode/file bytes/link target; timestamps, allocated
identifiers and directory sizes remain raw but are not semantic equality fields.
Raw public terminal results, byte APIs, process streams and module traces are kept.
Main-thread ESM resolution and CommonJS cache are audited against frozen hashes.
The corrected tracer is registered inside engine-child, not inherited by workers.
Copied package/tsconfig files are hashed and tsx is explicitly bound to the snapshot
configuration through its supported TSX_TSCONFIG_PATH environment setting.
Worker-internal WASM/data reads are not a system-call trace; their resolved local
assets and shipped loaders are independently hashed, and this limit stays explicit.

Assertions are predetermined workflow expectations, not a native universal oracle.
Status zero alone is insufficient. Both-failing never means parity. Informational
help, diagnostic node, and no-op wait cannot receive operational credit. Known
prerequisite blocks retain both primary and direct-target diagnostic observations.
SafeJS availability is separate from the four absent compatible CLI names.

Before freeze, the unused `/fixture/tmp` scratch requirement was reported to root
because it conflicts with shopt's prepared glob expectation. Root authorized
omitting that directory, preserving the recipe/expected bytes. The first freeze
raced with that ruling and is retained separately as a harness-fault attempt.
The corrected run applies approved setup, IPC flush, supported curl-limit and
trace/config-binding fixes, and adds exactly two approved array-read diagnostics.
No first-attempt failure is silently rewritten into a success or feature loss.

For independent replay, root must release the different reviewer. The stable
attempt manifest/inputs/raw paths and retained source snapshot are the subject;
running this launcher again by default would freeze a new source/port, not replay
the old inputs. Reviewer can launch the frozen engine-child entry with the exact
recorded argv/environment and recreate the recorded loopback endpoint, collecting
new outputs only in its owned subtree. Hash equality must precede replay.

No SGID or environment-order probe is included. Historical normative guidance in
`tests/commands/core-regression-stress/NORMATIVE_PROFILES.md` remains separate;
Darwin-specific observations do not establish Linux or universal POSIX behavior.
This audit does not complete the product goal or demonstrate superiority, speed,
full option coverage, broad parity or the requested 72-hour work duration.
