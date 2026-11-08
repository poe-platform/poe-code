# cmp private workspace

The command implementation lives in `packages/safe-bash-command-cmp`; Safe Bash
retains compatibility facades and composes its default and opt-in registrations.
The workspace stays private and has no external runtime dependencies. Canonical
contracts, filesystem primitives and input engines are declared prerequisites;
there is no dependency back to Safe Bash.

Preserve both profiles: `cmpCommand` retains default diagnostics and cumulative
verbose difference status; `createCmpCommand` retains the optional GNU diffutils
3.12 comparison-block behavior. Shared implementation does not establish profile
equivalence. Preserve streamed reads, skip/count arithmetic, cancellation,
explicit limits, input budgets and collision/replacement behavior.

Command-only behavior and block regressions belong to the private workspace. Shell integration
and native-oracle harness tests stay with Safe Bash. Keep their assertions intact.
The cmp unit task must build its declared prerequisites on a clean checkout.

Public consumers import `@poe-platform/safe-bash/commands/cmp` or the existing
`@poe-platform/safe-bash/cmp` route. The parent bundle owns distribution; no private
workspace is published or installed by consumers. The maintained cmp packed
fixtures cover both profiles, VFS scripts, pipes, canonical argument/runtime/error
identity, registration and cancellation, alongside strict NodeNext declarations.

Validation: selected workspace build, cmp unit/type/lint checks, Safe Bash cmp
regressions, package-safe and package-lint gates, then isolated tarball execution
and declaration resolution. No CLI output or default inventory changes are
intended, so no screenshot update is required.

The completion audit started from main `d682a429b3d860135245efb2916fb340242a1b5d`.
The implementation extraction was already present (introduced by `b9634cd075` and
subsequently consolidated); remaining work was test ownership, the unit build
prerequisite, this plan and focused distribution verification. A direct boundary
assertion reproduced the missing `^build` prerequisite before the graph change.

Verified the uncached maintained cmp unit task (seven tests), workspace lint and
source/test typechecks, and retained Safe Bash cmp regressions (363 passed; six
pinned GNU-oracle cases unavailable and not counted as passes). The full existing
package-safe suite passed 246 cases; the subsequently added cmp memfs packaging
case and graph assertion also passed. Installed tarballs passed actual Node Shell
execution and strict NodeNext declarations with no private workspace installed.
Browser and workerd bundles passed the cmp fixture in realms without host
filesystem, process or network capabilities. Portable syntax uses valid UTF-8;
Node additionally verifies raw invalid argument bytes and their diagnostics.

Final ownership verification passed all 32 cmp workspace tests and the retained
Shell registration/invocation case after moving the remaining command-only tests.
The optional repository-wide build was stopped during unrelated native/playground
work; it is not claimed as a successful full build. The broader package-lint run
reported four missing built assets in unrelated packages. Scoped dependency,
private-publication, exports, asset-collocation and package documentation gates
are used for this change, with actual isolated tarball/runtime checks above.

After rebasing onto current main, the selected Safe Bash workspace build passed,
as did the uncached 32-test cmp unit task, 338 retained cmp regression/integration
tests (six unavailable oracle cases skipped), all 249 package-safe tests, and all
ten selected package-lint rules. Concurrent find/truncate fixture additions and
SQLite declaration admission were preserved. No selected cmp runtime or packaging
implementation changed during the final rebase.
