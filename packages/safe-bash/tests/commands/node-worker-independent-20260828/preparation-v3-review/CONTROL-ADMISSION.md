# Finite synthetic admission, 2026-08-28

After frozen-source inspection, before subject imports: one ordinary Node child,
30-second outer timeout, 1 MiB stdout/stderr each, no Worker/compiler/engine,
network, subprocess, private source, or production imports. Only byte-identical
`parent-rpc.mjs`, `wire.mjs`, `errors.mjs`, `json-size.mjs`, `reservations.mjs`
are materialized in a fresh owned temporary directory. The runner below is the
exact versioned recipe. Hash all six modules before launch; preserve exit/capture
before assertions and remove only this newly owned directory after settlement.

Ten recipe groups S1a/b/c, S2a/b, S3a, S4a/b/c, S6a exercise actual frozen
parent/wire helpers with a declared synthetic owner/provider, in-process SAB
publication, and no blocking Atomics.wait. This does NOT execute owner.mjs:
its fixture dependency requires the not-yet-authorized compiled FsError module.
S3 proves parent refusal to publish FREE after a rejecting close, not actual
owner cleanup integration. Error recognition is an explicit synthetic predicate,
not qualification of compiled FsError or SafeJS catch behavior.

S5a remains source/DATA arithmetic only: scaffold execution is engine/guest
execution and forbidden. L08a remains source-only: actual heap enforcement needs
a Worker and is forbidden. Do not report 12 executed author controls or ten guest
evaluations. Original author recipes and history stay unchanged.

The total review preseal limits remain binding. No retry after unsafe cleanup;
ordinary assertion failures are captured individually. No production edits.
