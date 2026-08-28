# Restricted yq module

This optional module implements the frozen restricted YAML 1.2.2 Core-profile
reader and deterministic formatter over the existing bounded jq interpreter.
It is not Mike Farah yq syntax or a full YAML implementation. It has no runtime
dependency, native fallback, host-process execution, implicit registration,
public limit configuration, write mode, slurp, or eval-all mode.

The module exports `createYqCommand()`, `createYqCommands()`, and
`yqCommands({ replace? })` from `src/commands/yq/index.ts`. Root/package exports
and default aggregate registration are deliberately outside this module's
ownership. The private query adapter is `src/commands/structured/query-core.ts`.

Input and output documents are wholly retained within fixed logical byte,
node, depth, collection, result, and output admissions. Those admissions do not
claim an aggregate heap/RSS/CPU/latency bound or preemption of provider or query
engine internals. Query compilation and bounded interpreter internals retain
their documented synchronous qualifications. Supplied-signal VFS and sink work
is awaited; completed sink effects cannot be rolled back.
