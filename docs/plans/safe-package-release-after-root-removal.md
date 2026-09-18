# Canonical filesystem identity for scoped Safe packages

The root package no longer ships Safe runtimes. Validate scoped publication on
current main and preserve the standalone publisher that owns its runtime bundles.

Portable browser regressions reproduce duplicated filesystem constructors from
retired root imports. Use the upstream browser alias from the workspace route to its canonical
external route, retaining all identity assertions and the workspace platform import. The playground worker
must bind both the legacy and workspace routes to its existing canonical module.

Verify maintained portable browser and playground unit checks, normal root
build, standalone scoped packaging, installed tarball smoke and browser fixtures,
ZIP acceptance in Node and workerd, full maintained tests and repository lint.
Deliver directly to main and dispatch the manual scoped publishing workflow;
monitor root and scoped publication through successful registry verification.
