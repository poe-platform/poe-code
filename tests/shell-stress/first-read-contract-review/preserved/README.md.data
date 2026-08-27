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

Whole-suite and comparison scores are historical, revision-specific evidence,
not a current clean-worktree claim. See [the timestamped project ledger](docs/PROJECT_LEDGER.md)
and its linked reports for original failures, later source fixes, fixture/profile
changes and scoped acceptance. Original reports are preserved; no selected suite
or command count establishes the full product goal.

The package exposes `S3FileSystem` plus `createS3Transport` for an explicit
caller-supplied minimal client. The separate HTTP/SigV4 factory
`createS3HttpTransport` and its types are public at `virtual-bash` and
`virtual-bash/fs/s3/http`. [Clean packed-consumer checks](tests/integration/s3-http-exports/REPORT.md)
verify these imports and declarations, not complete real-service integration.
Actual-service workflows and provider conditional-operation guards require
separate evidence; mock/loopback and trusted host-resolver tests do not establish
arbitrary-provider support.

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

`agentCommands(options?)` installs twelve delivered families once: standard,
text programs, structured (`jq`), search (`rg`), byte tools, diff/patch,
metadata (`chmod`, `stat`, `mktemp`), archives (`tar`), table-text
(`paste`, `comm`, `join`), stream inspection (`tac`, `expand`, `fold`, `strings`),
stream formatting (`seq`, `nl`, `rev`, `unexpand`), and splitting (`split`),
totaling 65 unique registered plugin names. These families have separate scoped evidence;
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
  streamInspection: { limits: { maxInputBytes: 16 * 1024 * 1024 } },
  streamFormat: { limits: { maxRecordBytes: 1024 * 1024 } },
  split: { limits: { maxFiles: 128 } },
});
```

These are per-family limits, not a shared resource budget. Byte tools retain
their existing fixed limits. Shell-wide limits belong in `new Shell({ limits })`.
`exec` buffers its returned output under shell limits, while internal pipes use
streaming byte sources/sinks and backpressure. Commands never spawn native
processes. Native utilities appear only as trusted test/benchmark oracles.

## Stream Formatting and Splitting

The root and `virtual-bash/commands/stream-format` export
`createStreamFormatCommands`, `streamFormatCommands`,
`StreamFormatCommandsOptions`, and `StreamFormatLimits`. The root and
`virtual-bash/commands/split` export `createSplitCommands`, `splitCommands`,
`SplitCommandsOptions`, and `SplitLimits`. Factories return definitions;
plugins install them. All five commands are already included in the default
aggregate. Do not install the standalone plugins again unless intentionally
replacing commands. Aggregate `streamFormat` and `split` options omit `replace`;
the aggregate's single replacement policy applies to every family.

For example, with the default aggregate and a memory filesystem,
`seq 1 3 | nl -ba -w1 -s: | rev | unexpand -a | split -l2 - /lines.`
writes `/lines.aa` containing `1:1\n2:2\n` and `/lines.ab` containing `3:3\n`.
Split output is VFS data, not host files. The separate `streamInspection` option
and its four commands remain unchanged.

Stream-format defaults per invocation are input 32 MiB, output 64 MiB, record
8 MiB, chunk 1 MiB, 64 files, 268435456 steps, 65536 argument bytes and 4096
numeric digits. Split defaults are input/output 256 MiB each, 4096 files,
8 MiB buffer, 64 KiB chunk, 65536 argument bytes, suffix length 128 and
536870912 steps. Overrides are positive safe integers. These family bounds do
not replace shell-wide budgets; cancellation does not roll back completed I/O.

Supported flags and exclusions remain documented in
`src/commands/stream-format/README.md` and `src/commands/split/README.md`.
Their old source-only availability statements describe the pre-integration
checkpoint, superseded by this public integration. In particular, numeric
formatting is not all GNU floating/locale behavior; `rev` uses byte/C or UTF-8
codepoint profiles, not grapheme reversal; `unexpand` uses C-byte columns;
split does not implement `-n`/`--number`, `--filter`, custom record separators
or hexadecimal suffixes. No new algorithm or flag support is implied.

Public build, moved offline package, strict TypeScript and qualified native
evidence is in `tests/plugins/stream-five-public/README.md`. The qualified
release command there is additive to the existing portable checks, not their
replacement. The current mandatory profile is documented in
`tests/plugins/qualified-current-release/README.md`: it additionally requires
`--archive-tar-from` pointing to the authenticated existing GNU tar 1.35 binary,
stages it at both archive fixtures' hardcoded location, and runs build-first
current standalone public consumers. `GNU_TAR` alone does not configure those
fixtures. Current provider-only programs receive strict public type checks,
not an invented deployed-service pass; frozen `.mts` evidence stays historical.
The root config now excludes only the classified native-glob data subtree in
addition to its pre-existing exclusions; it still does **not** include all
TypeScript files. Classification, current type/discovery counts and negative
controls are recorded in `tests/plugins/qualified-current-release-native-data/REPORT.md`.
The recorded current candidate's mandatory job remains **failed** because the
unchanged WebDAV consumer reports12/13; see
`tests/plugins/qualified-current-release/REPORT.md`. Native/packed successes do
not waive that failure.
The retained native cohort has **124/164 strict** executions
and **164/164 diagnostic-meaning-v2** executions: **40 exact stderr differences
remain**, so these results are not full parity or a full-project gate.

The qualified stream/native profile and scoped 65-command consumer success do
not establish overall package lifecycle acceptance or release readiness. Per
the user's August 27, 2026 update, **five public premature-cleanup failures
remain OPEN**, routed to Sagan/Arch pending independent closure. Optional
`InvocationCleanup` contract `07acb1a4` alone does not establish that closure;
runtime/regex integration remains in progress in that update.

## Stream Inspection Commands

The package root and `virtual-bash/commands/stream-inspection` export
`streamInspectionCommands(options?)`, `createStreamInspectionCommands(options?)`,
`StreamInspectionCommandsOptions` and `StreamInspectionLimits`.
Options are `{ replace?, limits? }`; the factory returns readonly command
definitions. All four commands are already in `agentCommands()` and
`createAgentCommands()`. Use the standalone plugin instead of the aggregate,
not in addition to it unless replacement is intentional.

```ts
import { Shell, agentCommands, createMemoryFileSystem } from "virtual-bash";

const shell = new Shell({ fs: createMemoryFileSystem() }).use(agentCommands());
try {
  const result = await shell.exec(
    "printf 'old\\tline\\nnew\\tline\\n' > log; tac log | expand -4 | fold -bw8 > report; cat report",
  );
  console.log(result.stdout);
} finally {
  await shell.dispose();
}
```

This produces `new line\nold line\n` through byte pipes and VFS files.
`tac` reverses records per operand, with `-b`/`--before` and literal
`-s`/`--separator`; it buffers an entire operand within configurable limits,
not constant memory. `expand` supports `-i`, `-t` tab lists and numeric forms
such as `-4`; `fold` supports `-b`, `-s`, `-w` and numeric widths such as `-3`.
Both use fixed C/POSIX byte columns, not Unicode display widths.
`strings` scans raw 7-bit ASCII plus TAB runs, with `-a`, `-n`, numeric minimum
lengths such as `-5`, `-t d|o|x`, and `-f`; it does not parse object sections.
Its lone `-` selects raw scanning rather than a stdin file operand.

Defaults per invocation are input 32MiB, stdout 64MiB, record 8MiB, chunk 1MiB,
64 files, 268435456 work steps and 65536 argument bytes. Positive-safe-integer
overrides belong in `streamInspection.limits`; shell-wide budgets still apply.
Regex `tac`, Unicode width/decoding and strings object/encoding modes remain
unsupported. Numeric syntax follows the pinned GNU9.7/GNU strings2.44 on Darwin
cohorts, not a GNU/Linux or full diagnostic-byte parity claim. Exact profiles,
flags and bounds are in `src/commands/stream-inspection/README.md`; author public
integration evidence is in `tests/integration/stream-inspection-public-author/`.
Curl and SafeJS remain explicitly optional and are not registered by this family.

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
it does not prevent delivery of the verified curl scope. Current root assignments
govern source/test ownership; historical assignments are recorded in the ledger.

The current default aggregate has 65 unique plugin names; optional `curl` and `safejs`
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
and actual-host setup. Actual SafeJS integration is not closed. The upstream
proposal 0c1bfe2 is not approved; isolated patched runs do not establish accepted integration, guest
lifecycle success or replay durability. See the ledger for separate cohorts.

## Validate

```sh
npm run typecheck
npm run build
npm test
SAFEJS_LOCAL_ROOT=/path/to/poe-code/packages/safejs npm test
```

Typechecking and default test discovery both omit exactly
`tests/commands/regex-execution/continuation/artifacts/native`, whose `.ts`
names are native glob inputs, not maintained TypeScript. Other artifact trees,
tests and helpers are not broadly excluded. The August 27 native-data correction
removes six raw-payload diagnostics, but the recorded global typecheck still
fails with eight foreign filesystem-inspection fixture diagnostics; it is not
a whole-product pass. Historical standalone `.mts` omissions and the separate
build-first consumer gate remain unchanged.

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
