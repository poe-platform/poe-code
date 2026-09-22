# csvstat command wiring prerequisite verification

Verified against the working tree on 2026-09-20. `command-csvstat` is incomplete.

The requested wiring has no implementation to consume. Searches of package
source paths and workspace declarations found no
`packages/safe-bash-command-csvstat`, csvsort inference implementation, or
admitted shared CSV parser, selector and Decimal/inference workspace. The
existing engine and behavior prerequisite findings independently record these
missing implementations:

- [Engine prerequisites](safe-bash-csvstat-engine-prerequisites.md).
- [Behavior prerequisites](safe-bash-csvstat-behavior-prerequisites.md).
- [Independent acceptance controls](safe-bash-csvstat-acceptance.md).

The earlier engine task's done status in `safe-bash-csvstat.md` does not establish
implementation readiness. Its prompt requires shared parser, selector and
inference contracts and prohibits duplicating shared engines. The command task
cannot supply native-equivalent statistics by wiring JavaScript Number
aggregations or a substitute temporal parser. In particular, the large-integer
and microsecond/aware-instant controls need exact typed values before formatting.
This is a missing prerequisite, not a reproduced command defect.

The package-pattern document is deleted at its requested path in this working
tree. Its available archived copy was inspected at
`archive/safe-bash-command-package-pattern.md`; neither path was changed.
XAN CSV/selector implementation contents were not read, imported or extracted.

## Verified integration path

`docs/safe-bash-command-workspaces.md` describes the maintained contract.
`safe-bash-contracts` supplies canonical CommandDefinition, byte arguments,
streams, plugin and cleanup contracts. A command must depend on that leaf,
without a return dependency on safe-bash.

`packages/safe-bash/package.json` currently has neither a csvstat export nor a
csvstat dependency/private-workspace admission profile. Existing fold, fmt,
diff3 and unrtf facades show explicit opt-in subpaths. Integrating the real
csvstat implementation requires parsed/deep-merged manifest entries for its
dependency, `./commands/csvstat` export and exact
`poeCode.integration.privateWorkspaces` profile, plus a static source facade.
Imports must leave default registration unchanged.

`scripts/bundle-safe-bash.mjs`'s `resolvePrivateCommandBuild` already prepares
admitted private command workspaces through shared ESM chunks and validates
privacy, version, dependency declarations and paired runtime/declaration exports.
`scripts/package-safe.mjs` owns artifact traversal and AST-based private runtime
and declaration rewriting. `packages/safe-bash/scripts/build.mjs` remains the
guarded compiler route. No per-command bypass or independent contracts copy is
needed or authorized.

## Unblocking and acceptance

Complete and admit the shared reader/selector/inference and exact statistics
contracts first. Then introduce failing memory-VFS command tests against those
real APIs before implementing the command handler and equivalent typed SDK
options/results. Cover argument grammar and status 2, source validation order,
literal paths/stdin, chunk ownership, awaited output, signal forwarding,
cleanup-before-acquisition, quotas and cancellation propagation using the
independent acceptance specification.

Extend maintained package-safe memfs coverage and isolated installed runtime
and strict NodeNext declaration consumers. Verify the public subpath without
private workspaces, canonical runtime/error/argument identity and VFS pipeline,
middleware and script dispatch. Run maintained focused lint/unit/build closure
and installed-artifact checks before claiming wiring or bundle acceptance.

Only this prerequisite record was added. No placeholder command, export or
build-policy admission was added. No runtime tests, build, CLI screenshots or
packed-consumer acceptance were executed because no runtime code changed.
Unrelated edits and plan statuses were preserved. No commit, push, release or
package publication was performed.
