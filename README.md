# virtual-bash

A virtual Bash companion to `poe-code safejs`, inspired by `just-bash`.

The requested scope includes Express-like plugins; memory, real,
S3-compatible (with a mock), WebDAV, and additional filesystems; many agent
tools; and piping, stdin, and full shell support.

## Status

TypeScript, ESM, Node.js 22 or newer; zero runtime dependencies. Development uses
TypeScript, `tsx`, and `node:test`. The package is currently private/unpublished;
the repository directory is `safe-bash`, while the package name is `virtual-bash`.

Implemented components include streaming shell execution, command plugins,
memory/real/S3/WebDAV filesystem adapters, readonly/mount/overlay wrappers, and
injected SafeJS bridges. They are not complete Bash or native-utility parity.
The user's requirement **"IT MUST BE BETTER than just-bash, much better"** remains
unproven; command counts and selected passing fixtures do not establish it.

The committed snapshot `f4eb0b327fd5a14f49dc6007f14f613b43cdaeea` builds and
typechecks, but its 4,815 tests include 51 failures, 5 skips, and 4 TODOs
(4,755 passes). Its all-plugin comparison is 116/118 passes versus pinned
just-bash 3.4.2's 108 passes, 9 failures, and 1 unsupported case. These are
snapshot-specific results, not a clean bill of health for the moving worktree.
See `benchmarks/reports/aggregate-head-integration.json` for exact failures and
environment metadata; the companion `-comparison.json` retains both engines.
The failures include 30 diff/patch cases, 10 shell differential gaps, and 11
stdin-origin integrations whose rg consumer changes were not yet committed in
that snapshot. All 19 aggregate tests pass. Earlier evidence remains recorded.

A later complete archive, `22fd7e5d46fb00409761196cbaf1ddc27f16f9bf`, has
6,729 passes, 59 failures, 9 external-oracle skips and zero TODOs out of 6,797;
build/typecheck and actual-local SafeJS pass. Newly added tests and native
reference differences affect the totals. `benchmarks/reports/FAILURE_TRIAGE.md`
classifies every original failure and distinguishes source fixes, live gaps,
fixture changes, dialects and oracle limitations. No clean full-suite claim is made.

A later **comparison-only** archive at
`e432c52147a4f355fbae9083cfe1d94a3f78f86d` includes the committed rg provenance
and absolute patch-target fixes: virtual passes 118/118, while just-bash retains
108 passes, 9 failures, and 1 unsupported case. See
`benchmarks/reports/post-integration-comparison.json`. This does not replace the
earlier full-suite result, prove all its failures fixed, or establish superiority.

## Use the command bundle

After `npm ci` and `npm run build`, package-root imports expose the aggregate:

```ts
import { Shell, agentCommands, createMemoryFileSystem } from "virtual-bash";

const shell = new Shell({ fs: createMemoryFileSystem() }).use(agentCommands());
try {
  const result = await shell.exec(
    "printf 'hello\\n' | sed 's/hello/world/' | awk '{print $1}'",
  );
  console.log(result.stdout);
} finally {
  await shell.dispose();
}
```

The result contains `world` followed by a newline.

`agentCommands(options?)` installs all six delivered families once: standard,
text programs, structured (`jq`), search (`rg`), byte tools, and diff/patch.
Do not also install those families unless you deliberately request replacement.
The bundle checks every name for collisions before changing the registry;
`replace: true` applies uniformly across all families, leaving unrelated commands.

`createAgentCommands(options?)` returns command definitions for a custom registry
instead of installing a plugin. Its registry-only fallback resolves commands
across the bundle; `agentCommands` also resolves external host commands. Both
prefer `context.invoke` for nested execution, preserving the shell's middleware
and budgets. `execute` supplies a fallback only when that hook is unavailable.

Family options keep their existing types and semantics, with one top-level
replacement policy:

```ts
agentCommands({
  replace: false,
  text: { maxSteps: 1_000_000, maxBufferBytes: 8 * 1024 * 1024 },
  structured: { limits: { maxInputBytes: 8 * 1024 * 1024 } },
  search: { maxLineBytes: 1024 * 1024, defaultInput: "auto" },
  diffPatch: { maxInputBytes: 8 * 1024 * 1024, maxWork: 1_000_000 },
});
```

These are per-family limits, not a shared resource budget. Byte tools retain
their existing fixed limits. Shell-wide limits belong in `new Shell({ limits })`.
`exec` buffers its returned output under shell limits, while internal pipes use
streaming byte sources/sinks and backpressure. Commands never spawn native
processes. Native utilities appear only as trusted test/benchmark oracles.

## Validate

```sh
npm run typecheck
npm run build
npm test
SAFEJS_LOCAL_ROOT=/path/to/poe-code/packages/safejs npm test
```

The last form enables actual local SafeJS integration rather than skipping it;
no published private SafeJS dependency is required. Optional comparison tooling
is isolated: `npm --prefix benchmarks ci --ignore-scripts`, then `npm run benchmark`.
Nonpasses, unavailable oracles, and documented utility-dialect disagreements must
remain visible. GNU sed policy exceptions and original BSD evidence are recorded
in the ledger and text-program stress reports, not treated as universal parity.

See [the project ledger](docs/PROJECT_LEDGER.md) for the complete recorded
requirements, validation gates, ownership, and pending work. Contributors must
follow [the project rules](AGENTS.md).
