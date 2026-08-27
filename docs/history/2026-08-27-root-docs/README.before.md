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

A broader, separate 224-case comparison freezes product source at
`bd2cacb3a20403302fd0a49441932d5522793e56`: **206 pass / 18 fail** versus
just-bash 3.4.2's **155 pass / 69 fail**, with zero skips/timeouts/errors.
It executes all 53 unshadowed default plugins and explicitly measures shell
gaps: the kernel cohort is 29/36 versus 36/36. These are 223 unique input
workloads, not full option coverage. Two initial oracle defects and their old
scores remain preserved; no production code changed to improve these results.
See `benchmarks/reports/expanded-20260827/ANALYSIS.md` for failure ownership,
missing baseline tools, byte-API controls, matched performance wins **and losses**,
and the still-pending independent fairness review. This is not a global suite or
superiority claim; `benchmarks/expanded/README.md` gives reproduction commands.

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

`agentCommands(options?)` installs nine delivered families once: standard,
text programs, structured (`jq`), search (`rg`), byte tools, diff/patch,
metadata (`chmod`, `stat`, `mktemp`), archives (`tar`), and table-text
(`paste`, `comm`, `join`), totaling 56 registered plugin names. Table-text is an
delivery with a bounded 104/104 independent checkpoint; archive review is in progress;
name registration is not proof of complete utility semantics.
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
  metadata: { umask: 0o022, limits: { maxEntries: 100_000 } },
  archive: { limits: { maxArchiveBytes: 64 * 1024 * 1024 } },
  tableText: { limits: { maxRecordBytes: 1024 * 1024, maxGroupBytes: 8 * 1024 * 1024 } },
});
```

These are per-family limits, not a shared resource budget. Byte tools retain
their existing fixed limits. Shell-wide limits belong in `new Shell({ limits })`.
`exec` buffers its returned output under shell limits, while internal pipes use
streaming byte sources/sinks and backpressure. Commands never spawn native
processes. Native utilities appear only as trusted test/benchmark oracles.

## Table-text Commands

The root and `virtual-bash/commands/table-text` export
`tableTextCommands(options?)`, `createTableTextCommands(options?)`,
`TableTextCommandsOptions` and `TableTextLimits`. Options are `{ replace?, limits? }`.
The three new commands are paste, comm and join; cut stays in the standard family.
Use either the standalone plugin or the aggregate, without double-registration.

```ts
const shell = new Shell({ fs, env: { LC_ALL: "C" } }).use(agentCommands());
await shell.exec("join names colors | cut -d ' ' -f2,3 | paste -sd, -");
```

Inputs are virtual paths or stdin; bytes and NUL records remain bytes. Input,
output, chunks, records, fields, files, duplicate-key groups and work are bounded;
writes are awaited and VFS work receives cancellation. Comm/join explicitly use
the C/POSIX byte profile, not locale-aware Unicode collation. Exact flags,
limits, GNU9.7 evidence and known gaps are in `src/commands/table-text/README.md`.
The preserved comm shared-stdin disagreement is not a native parity pass.
Author tests do not substitute for a different agent's stress/fix review.

## Archive Commands

The package root and `virtual-bash/commands/archive` export
`archiveCommands(options?)`, `createArchiveCommands(options?)`,
`createTarCommand(options?)`, `ArchiveCommandsOptions`, `ArchiveLimits` and
`DEFAULT_ARCHIVE_LIMITS`. Register the standalone plugin or use `agentCommands`,
not both unless replacement is intentional. Options are `{ replace?, limits? }`.

With `/input` and `/output` already created in the VFS, the aggregate can run:

```ts
await shell.exec("tar -cf - -C /input . | tar -xf - -C /output");
```

This transfers byte streams through virtual pipes; no product subprocess or host
filesystem fallback is used. Author checkpoint `be29e38`/`0eaffb7` reports
128 tests and four built checks. Independent archive source/test review belongs
to Dirac and is not complete here. Exact author flags, bounds and hardlink
restrictions remain in `src/commands/archive/README.md`; this integration does
not certify hardlink completeness, arbitrary archive safety or full tar parity.

## Metadata Commands

The package root and `virtual-bash/commands/metadata` export
`metadataCommands(options?)`, `createMetadataCommands(options?)`,
`MetadataCommandsOptions`, and `MetadataLimits`. Install this family separately
only if you are not already using `agentCommands()`:

```ts
import { Shell, createMemoryFileSystem, metadataCommands } from "virtual-bash";

const fs = createMemoryFileSystem();
await fs.mkdir("/tmp");
const shell = new Shell({ fs }).use(metadataCommands());
try {
  const result = await shell.exec("file=$(mktemp); chmod 600 \"$file\"; stat -c '%a:%s' \"$file\"");
  console.log(result.stdout);
} finally {
  await shell.dispose();
}
```

The example returns `600:0` followed by a newline. `chmod` supports
numeric/symbolic modes, recursion and reference modes; `stat`
supports common format fields and deterministic UTC millisecond timestamps;
`mktemp` creates exclusive private files/directories using crypto randomness.
Temporary directories must already exist in the VFS (`TMPDIR` or `/tmp` by
default), never in an implicit host fallback. Unsupported backend permissions
and absent optional metadata fail explicitly; dry-run names are not reserved.
The configurable virtual umask defaults to 0022, not the host process umask.
See `src/commands/metadata/README.md` for exact flags, limits, symlink behavior,
GNU/BSD differences and non-atomic race limits. Author evidence is in
`tests/commands/metadata/AUTHOR_CHECKPOINT.md`; this is not full GNU parity.

## Optional Curl Network Command

The user's explicit requirement **"i also need curl"** is implemented as an
opt-in HTTP(S) command, not ambient networking in `agentCommands()`:

After `npm run build`, run this GET example from the repository using
`node --input-type=module`. It grants only the example.com HTTPS origin:

```ts
import { Shell, agentCommands, createMemoryFileSystem, networkCommands } from "virtual-bash";

const shell = new Shell({ fs: createMemoryFileSystem() })
  .use(agentCommands())
  .use(networkCommands({
    authorize: ({ url }) => new URL(url).origin === "https://example.com",
  }));
try {
  const result = await shell.exec("curl -fS https://example.com/");
  console.log(result.exitCode, result.stdout);
} finally {
  await shell.dispose();
}
```

Root and `virtual-bash/commands/network` exports include `networkCommands`
(`curlCommands` alias), `createNetworkCommands`/`createCurlCommands`,
`createCurlCommand`, `createNodeHttpTransport`, contracts and limits.
The authorizer runs before every request/redirect/retry; cross-origin redirects
drop credentials and all custom headers. URL allowlisting is not DNS pinning.
Hosts can inject a transport or CA without changing global TLS/environment state.
Downloads/uploads use byte streams and VFS paths, never implicit host files or
native curl. Unknown options and unsupported protocols are rejected.

Curl's accepted bounded independent finalization is **`17285d1`**, on stable
network source **`aa2da57`**. Its six cohorts ran once each: **81 author + 60
independent + 18 supplemental + 18 retry + 15 lifecycle + 22 policy = 214
targeted passes**. Build and **5/5 actual built-package loopback workflow checks**
also pass. The single global typecheck records three unrelated filesystem-test
errors; this is not a clean whole-repository claim. See
`tests/commands/network-stress/finalization/FINAL_REPORT.md` for exact evidence.

Independent fixes preserve native-visible retry stdout and reset curl-managed
output files between attempts. Assertion-only `cbde2fe` reconciles one stale
author expectation with frozen native evidence, without changing the runtime or
denominator. Historical **80/81 author**, **57/60 independent** and **14/15
lifecycle** observations remain preserved, not relabeled as original passes.
This is not full curl parity or DNS/socket confinement. The separately tracked
pre-first-byte `head -n 0` custom lifecycle issue is not fixed by this checkpoint;
it does not prevent delivery of the verified curl scope. Archimedes retains
network source/test ownership until reassigned.

The current default aggregate has 56 plugin names; optional `curl` and `safejs`
add one each only when explicitly installed. At curl finalization, the committed
aggregate still had 49 names while uncommitted metadata wiring exposed 52 in
the working tree and its built package. That historical build/smoke remains a
moving-worktree result, not an isolated committed-HEAD snapshot. Later metadata
integration does not retroactively change that evidence. Runtime dependencies
remain zero.
The older frozen package audit at `b98e239` retains its 15-export evidence in
`benchmarks/reports/PACKAGE_AUDIT.json`; it is not rescored here. Exact flags,
bounds and unsupported features remain in `src/commands/network/README.md`.

## Optional SafeJS Command

The root exports `safeJsCommands(options?)`, `createSafeJsCommands(options?)`,
`SafeJsRuntime<Budget>`, `SafeJsCommandsOptions<Budget>`, limit types/defaults and
`SafeJsCommandLimitError`. This plugin registers only `safejs`; `agentCommands()`
does not install it. The application must explicitly provide its legitimate
runtime, including `run`, `createBudget`, `makeFsModule` and `declareHostOperation`.
The library neither installs nor dynamically loads a private SafeJS package.

```ts
import {
  agentCommands, createMemoryFileSystem, safeJsCommands, Shell,
  type SafeJsRuntime,
} from "virtual-bash";

function createShellWithSafeJs<Budget>(runtime: SafeJsRuntime<Budget>) {
  return new Shell({ fs: createMemoryFileSystem() })
    .use(agentCommands())
    .use(safeJsCommands({ runtime, limits: { timeoutMs: 3000 } }));
}
```

Dispose the returned shell after use. Explicitly registering the optional plugin
without a runtime does not enable execution: source execution returns status
127. There is no host JavaScript evaluator or native-process fallback. See the
[command documentation](src/commands/safejs/README.md) for guest modules, limits
and actual-host setup. Independent verification is ongoing; author integration
results do not establish blanket SafeJS lifecycle or replay guarantees.

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

Backend unit tests alone do not establish tool interoperability. The unchanged
cross-adapter matrix passes 76/79 at archived `1c846a1`; later archived `b8df9e1`
passes 68/79, including eight diagnostic-assertion disagreements and three
remaining functional gaps. Exact cases, revisions, policy changes and reproduction
are in [adapter matrix triage](benchmarks/reports/ADAPTER_MATRIX_TRIAGE.md).
These local S3/mock and WebDAV/HTTP checks do not prove deployed-provider parity.

Filesystem callers receive typed `FsError` values with a stable `code` field.
Shell stderr instead follows human-readable Bash/utility diagnostics; do not
treat it as an errno serialization format. Integration checks must preserve
exit status, error meaning/path and filesystem effects when reconciling wording.
