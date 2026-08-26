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

## Diff and patch

The bundle includes `diff` and `patch`; `diffPatchCommands(options?)` installs
just that family. Existing package exports and plugin signatures are unchanged.

`diff` emits normal format by default (`--normal`). Unified output uses `-u`,
`-U N`, or `--unified[=N]`; context output uses `-c`, `-C N`, or
`--context[=N]`. It also accepts `-q`/`--brief`, `-r`/`--recursive`,
`-N`/`--new-file`, and up to two `-L`/`--label` arguments. `-b`/
`--ignore-space-change` and `-w`/`--ignore-all-space` affect comparison rather
than rewriting emitted file content. These are bounded text utilities, not
complete GNU/BSD utility replacements; option-order and whitespace-dialect
differences remain separately recorded by the independent verifiers.

`patch` reads stdin or `-i FILE`/`--input=FILE`, autodetects unified, normal, and
context input, and accepts `-u`/`--unified`, `-n`/`--normal`, and
`-c`/`--context` as format assertions. Normal input requires one explicit target.
Other supported options are `-p N`/`--strip=N`, `-R`/`--reverse`, `--dry-run`,
`-F N`/`--fuzz=N` (default zero), and `-l`/`--ignore-whitespace`
(`--ignore-white-space` is also accepted). Loose matching permits differing
nonempty horizontal whitespace runs; it does not erase required separators.

An explicit target such as `patch /work/file < change` authorizes that absolute
**virtual** path, not a host path. Relative explicit targets work too; absolute
`-i` paths read the virtual filesystem. Without an explicit target, absolute
header paths remain rejected. With one, headers are validated but never select
another file, and `-p` does not strip the explicit target. Traversal, Windows
drive components, directory-shaped labels, symlink paths/ancestors, and
hard-linked targets remain rejected. Validation rejects traversal before
normalization or stripping. Git C-quoted paths and repeated separators are
supported without treating decoded traversal as safe.

Supported edit flows include `/dev/null` creation/deletion, epoch-dated empty
sides in unified/context headers, incomplete final lines, reverse application,
and repeated sections for the same normalized target. Timestamp recognition
supports ISO-style and traditional `ctime` headers; it follows GNU patch 2.8's
measured near-epoch window (strictly between -25 and +26 hours), not timestamp
restoration or arbitrary date syntax. Zero-origin insertions can create a
missing target without an epoch marker; deleting to an ordinary non-epoch
empty side leaves an empty file. A bounded mail preamble/signature is accepted,
but unsupported binary, mode-only, rename, copy, and ed patches are not.

All sections are parsed and applied to staged contents before publication.
Coherent repeated targets publish their final result once; a later parse error,
conflict, or preflight cancellation publishes nothing. `--dry-run` never writes.
Publication rechecks targets, but these checks are **not race-proof**: the
filesystem contract does not provide a multi-file transaction or rollback.
Failure or cancellation during publication can leave earlier writes committed,
and an uncooperative backend can complete a pending operation after cancellation.

Per-invocation defaults are 16 MiB input, 16 MiB aggregate output, 100,000
cumulative parsed lines (including converted formats and target contents),
8,000,000 work units, 4,000,000 diff-matrix cells, 1,024 file sections, and
10,000 hunks. `DiffPatchOptions` exposes these limits; raising one does not raise
the others. Mail preambles are limited to 1,024 lines/64 KiB and signatures to
8 KiB/128 split lines. Patch text must be valid UTF-8 without NUL bytes.

The optional source-owned native reference driver uses only a caller-selected
GNU patch 2.8 binary, bounded literal argv, and isolated temporary directories:

```sh
GNU_PATCH_BINARY=/path/to/patch-2.8/src/patch \
  node --import tsx tests/commands/diff-patch/patch-gnu-reference.ts
```

It records executable identity plus 126 exact status/content/existence checks;
native diagnostics are recorded rather than normalized into an asserted match.
This focused evidence does not replace the full comparison denominator or prove
full-shell compatibility or superiority.

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
