# SafeJS command workspace extraction

Baseline: `def4c5038b`. The previous Node extraction owns the five SafeJS bridge
modules under `safe-bash-command-node/src/commands/safejs`. Safe Bash forwards
those paths; its compatibility `safeJsCommands` alias registers `node`.

Move the runtime lifecycle, parsing, I/O, rendering, limit/type owner and their
filesystem/value helpers into private `safe-bash-command-safejs`. Node depends
on this leaf; compatibility facades preserve identities and existing imports.
Keep the independent interpreter injected into the bridge, retain current Node
runtime selection, inventories, opt-in exports, limits and supported profiles.
No new published package, command registration or external dependency.

Move command and bridge lifecycle regressions with the implementation. Retain
Node registration and real interpreter integration tests in Safe Bash. Validate
the missing boundary before extraction, then workspace build, unit tests,
strict source/test types, ESLint, package-lint and memfs packaging tests. Extend
isolated packed consumer checks through the existing public Node API for bridge
byte I/O, VFS scripts, limits, errors, cancellation and declaration resolution.
Verify portable profiles through the maintained package profile checks.

Delivery requires a focused diff review, commit, rebase over current remote main,
push and verification of remote ancestry. Release publication is separate.
