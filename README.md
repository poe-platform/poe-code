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

**Scoped priority-workflow acceptance (August 28, 2026):** ROOT accepts the
finite 31-case × three-layout membership on selected `8437e4ed` and its exact
858-file package `6b5863d5`: 15 original source passes plus 78 RUN02 passes
(16 source, 31 installed, 31 physically moved). This combines versioned evidence,
not a fresh 93-call run or a rescore of the original P16 STOP/unknown accounting.
The [acceptance and reservation closure](tests/integration/priority-command-workflows-20260828/npm-pin-rebinding-v2/p16-trace-repair-v4/actual-run02-v1/ROOT-ACCEPTANCE-AND-CLOSURE.md)
keeps setup/admission, Worker retirement, loader-request and logical-resource
qualifications separate. Both reservations are closed without release/reuse.
No arrays, Git, apply_patch, Node, YQ or XAN support is added by this proof;
78 defaults, TypeScript and zero runtime dependencies remain, with curl opt-in.
This is neither an overall just-bash win nor a global-release claim.

**Scoped coherent78 + indexed-array acceptance (August 28, 2026):** ROOT accepts
fixed composition `d111e5bf1f53aff16c5d4112e9ead2e025d6464f`, with the exact full
874-member package bound in the
[independent continuation report](tests/integration/coherent78-arrays-independent-20260828/f11-v2/REPORT.md).
Its 272 selected inputs contain only six accepted array overrides; `shell.ts`,
root APIs, package configuration and the 78 defaults remain unchanged. This is
acceptance of that composition, not the moving HEAD or a whole-product gate.

Evidence across existing-source-build, installed and physically moved layouts
retains 93 author-case outcomes and covers 72 corrected novel outcomes
(69 original passes plus three versioned F11 passes), alongside 30 type outcomes,
seven refusal controls, two loaded/activated mutant kills and four restored
positives. These proof categories must not be naively added. The original three
F11 failures from the missing virtual `/dev` parent remain preserved, with a
separate exact negative reproduction; the correction changes only that fixture.
Array SOURCE ONLY/MIXED and AST metadata cloning/serialization/cross-package
limitations remain, with no combined-memory/RSS, global-resource or universal
preemption guarantee. This acceptance makes no actual SafeJS or global-gate claim.

The [independently reviewed comparison](benchmarks/reports/current-comparison-20260827/measurement-review/FINAL_REVIEW.md),
sealed in `8670ebe8`, measured source `e33974b8` against pinned just-bash 3.4.2
(not a claim about the latest release):

| Separate cohort | virtual-bash | just-bash 3.4.2 |
| --- | ---: | ---: |
| Original oracle-predicate matches | 222/224 | 155/224 |
| Aligned oracle-predicate matches | 223/224 | 155/224 |
| Breadth target operational credit | 13/54 | 47/54 |
| Breadth control operational credit | 7/7 | 6/7 |

Original and aligned profiles overlap and must not be added. Breadth uses declared
functional intent, not native goldens; its diagnostics remain unscored. Failures,
including a baseline lifecycle failure excluded from operational credit, remain
in the report. These tables establish neither overall superiority nor a whole-gate
result for `8670ebe8` or the moving worktree.

The package exposes `S3FileSystem` plus `createS3Transport` for an explicit
caller-supplied minimal client. The separate HTTP/SigV4 factory
`createS3HttpTransport` and its types are public at `virtual-bash` and
`virtual-bash/fs/s3/http`. [Clean packed-consumer checks](tests/integration/s3-http-exports/REPORT.md)
verify these imports and declarations, not complete real-service integration.
Actual-service workflows and provider conditional-operation guards require
separate evidence; mock/loopback and trusted host-resolver tests do not establish
arbitrary-provider support.

## Use the command bundle

### User-priority coverage

The [user-provided priority table and source audit](docs/COMMAND_PRIORITIES.md)
distinguish implementation from native compatibility: `sed`, `rg`, `printf`,
`nl`, `cat`, `head`, `echo`, `find`, `tail` and `ls` are in `agentCommands()`;
`curl` is an explicit network plugin. Frozen Git M1A module
`9885390fb11454fa194a3e60fdbef198dbfdf633` has qualified ROOT acceptance;
`apply_patch` remains a module candidate under independent review. Git acceptance
does not authorize root exports/default integration or cover later packed-object
work; the accepted aggregate remains78 commands. M1B candidate `fca6f81d` and
ROOT-reported apply_patch candidate `753` remain under independent review;
the Node scaffold/provider remain pending, not accepted product Node support.
`safejs` is not Node, and `patch` is not `apply_patch`.
“Without the npm stuff” excludes npm/npx product commands only; npm, Node and
TypeScript development tooling remain. The counts in that table are supplied by
the user, not independently verified usage statistics or completeness scores.

The [Git M1A type adjudication and scoped assessment](tests/commands/git-independent-20260828/m1a-type-adjudication-v15/TYPE-ADJUDICATION.md)
binds 284 unmodified semantic groups (71 each across source, compiled, offline
installed and moved layouts), four original type passes plus the separately
observed exact missing-export negative, and three loaded-mutant detections,
three restores and three binding refusals. These are separate proof categories,
not a new aggregate type score or global green gate. Historical failing exits
remain unchanged. Private-writer joins are source-qualified; closed-stream and
registration observations do not establish native allocation/RSS bounds.
This read-only loose-object/index profile refuses packed-object storage and other
unsupported repository/configuration forms; native Git oracle workflows remain
unrun. It is not full Git compatibility, packed readiness or acceptance of live HEAD.

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

`agentCommands(options?)` installs the delivered families once: standard,
text programs, structured (`jq`), search (`rg`), byte tools, diff/patch,
metadata (`chmod`, `stat`, `mktemp`), archives (`tar`), table-text
(`paste`, `comm`, `join`), stream inspection (`tac`, `expand`, `fold`, `strings`),
stream formatting (`seq`, `nl`, `rev`, `unexpand`), splitting (`split`), and
time/environment (`date`, `sleep`, `printenv`), tree (`tree`), file (`file`),
grep aliases (`egrep`, `fgrep`), table layout (`column`), bounded HTML conversion
(`html-to-markdown`), usage accounting (`du`), expressions (`expr`), virtual
executable lookup (`which`) and cooperative deadlines (`timeout`), totaling 78 unique registered
plugin names. These families have separate scoped evidence;
name registration is not proof of complete utility semantics.
Do not also install those families unless you deliberately request replacement.
The bundle checks every name for collisions before changing the registry;
`replace: true` applies uniformly across all families, leaving unrelated commands.

`createAgentCommands(options?)` returns command definitions for a custom registry
instead of installing a plugin. Its registry-only fallback resolves commands
across the bundle; `agentCommands` also resolves external host commands. Both
prefer `context.invoke` for nested execution, preserving the shell's middleware
and budgets. `execute` supplies the existing utility fallback when that hook is
unavailable; `timeout` instead has its own explicit `timeout.invoke` fallback,
used only when the context has no `invoke` property.

Family options keep their existing types and semantics, with one top-level
replacement policy:

```ts
import { agentCommands } from "virtual-bash";

agentCommands({
  replace: false,
  regex: { maxWorkers: 2, maxQueuedBytes: 8 * 1024 * 1024 },
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
  timeEnv: { defaultTimeZone: "UTC", limits: { maxOutputBytes: 1024 * 1024 } },
  tree: { limits: { maxEntries: 10000, maxOutputBytes: 1024 * 1024 } },
  file: { limits: { maxSniffBytes: 65536, maxInputBytes: 1024 * 1024 } },
  column: { limits: { maxInputBytes: 1024 * 1024, maxRows: 10000 } },
  which: { limits: { maxProbes: 4096, maxOutputBytes: 1024 * 1024 } },
});
```

`which` searches invocation PATH/cwd and literal VFS paths using followed regular-
file `stat`, then delegated `access(X_OK)`; readonly wrappers are supported. It
does not inspect host PATH, execute files, read file contents or fall back to mode
bits or shell registry names. Absent PATH is a miss, including slash operands.
The bounded virtual profile supports leading `-a`, `-s` and `--`; it is not full
native `which`/`type -aP` parity or a guarantee of later execution permission.
`createWhichCommand`, `createWhichCommands`, `whichCommands`, `WhichCommandsOptions`
and `WhichLimits` are available from root and `virtual-bash/commands/which`.
Aggregate `which` accepts limits only; top-level `replace` remains authoritative.
The command awaits provider calls/writes with the invocation signal, without
acquiring stdin or new output ownership, or preempting opaque provider work.

For explicit stdin, virtual files, option parsing and executable lookup:

```ts
import { Shell, agentCommands, createMemoryFileSystem } from "virtual-bash";

const fs = createMemoryFileSystem();
await fs.mkdir("/bin");
await fs.writeFile("/bin/tool", new TextEncoder().encode("virtual file\n"));
await fs.chmod("/bin/tool", 0o755);
const shell = new Shell({ fs, env: { PATH: "/bin" } }).use(agentCommands());
try {
  const result = await shell.exec(
    "set -- -n reader; while getopts ':n:' option; do printf '%s:%s\\n' \"$option\" \"$OPTARG\"; done; which tool; cat",
    { stdin: "from stdin\n" },
  );
  console.log(result.stdout);
} finally {
  await shell.dispose();
}
```

The result is `n:reader\n/bin/tool\nfrom stdin\n`. `getopts` is a shell builtin,
not another aggregate plugin. `which` checks the VFS entry; this example does
not execute `/bin/tool` or consult host PATH. Use `stdoutBytes`/`stderrBytes`
when preserving binary output; `stdout`/`stderr` are decoded strings.

`timeEnv` accepts an optional `clock: () => number` in Unix milliseconds
(default `Date.now`), virtual timezone (default UTC), sleep scheduler/timer cap,
and bounded family limits. Invocation `TZ` overrides the configured timezone;
`date -u` selects UTC. No command changes the host clock or environment.
Root imports and `virtual-bash/commands/time-env` also expose
`createTimeEnvCommands`, `timeEnvCommands`, and the `TimeEnvCommandsOptions`,
`TimeEnvLimits`, `SleepScheduler` types for standalone use. Do not install the
standalone plugin over the aggregate without deliberate replacement.

```ts
import { Shell, agentCommands, createMemoryFileSystem } from "virtual-bash";

const shell = new Shell({ fs: createMemoryFileSystem() }).use(agentCommands({
  timeEnv: { clock: () => 1709210096123 },
}));
try {
  console.log((await shell.exec("date -u +%FT%T.%3NZ")).stdout);
} finally {
  await shell.dispose();
}
```

This prints `2024-02-29T12:34:56.123Z` followed by LF. Nanosecond fields preserve
available precision; millisecond clocks pad lower digits with zeros. Bare `%-N`
uses a documented virtual-clock policy, not strict GNU clock-resolution parity.
The `%g` compatibility rationale is limited to rendered calendar years0000–9999;
negative-century native counterexamples and five ICU zone-label differences
remain explicit. See `docs/integration/2026-08-27-TIME_ENV_PUBLIC.md`.

Tree and file are also available as standalone `treeCommands` / `fileCommands`
plugins, `createTreeCommands` / `createFileCommands` definition factories, and
`createTreeCommand` / `createFileCommand` single-command factories, from root or
`virtual-bash/commands/tree` / `virtual-bash/commands/file`. Their option/limit
types are `TreeCommandsOptions`, `TreeLimits`, `FileCommandsOptions`, `FileLimits`.
Aggregate `tree` and `file` options omit `replace`; top-level replacement remains
authoritative. Both use only the explicit VFS and byte streams, with no native
utility, host libmagic or implicit host filesystem fallback.

Tree uses bounded traversal, byte-order sorting, escaped names and a documented
ancestor-cycle profile. File classifies bounded content rather than claiming
complete format validation. Missing metadata/read capabilities remain errors;
unknown content size without streaming support is not guessed safe. Their
family limits and shared shell cancellation/output budgets both remain active.
Already-published output is not rolled back: a limit/cancelled traversal can
leave partial text or incomplete JSON. Qualified source review and native/profile
gaps are in `tests/commands/filesystem-inspection-stress/harness-review/INTEGRATION_HANDOFF.md`;
they are not full tree/libmagic parity or public-integration acceptance.

These are per-family limits, not a shared resource budget. Byte tools retain
their existing fixed limits. Shell-wide limits belong in `new Shell({ limits })`.
`exec` buffers its returned output under shell limits, while internal pipes use
streaming byte sources/sinks and backpressure. Commands never spawn native
processes. Native utilities appear only as trusted test/benchmark oracles.

Host-supplied commands, adapters, transports and SafeJS hooks are trusted
capabilities, not an OS sandbox for arbitrary host JavaScript. Cancellation is
cooperative: propagate signals and register owned cleanup before acquisition;
public settlement awaits registered cooperative cleanup. It cannot preempt
opaque CPU work or undo completed side effects. Optional owned-output scopes
close their destination without aborting unrelated file/header/stderr work.

## Cooperative timeout

The root and `virtual-bash/commands/timeout` export `createTimeoutCommand`,
`createTimeoutCommands`, `timeoutCommands`, `TimeoutCommandOptions`,
`TimeoutCommandsOptions`, and `TimeoutScheduler`. The default aggregate includes
`timeout`; standalone registration does not install the command being invoked.
Aggregate `timeout` options omit `replace`: the top-level replacement policy is
authoritative, including when a JavaScript caller supplies an extra nested field.

```ts
import { Shell, agentCommands, createMemoryFileSystem } from "virtual-bash";

const shell = new Shell({ fs: createMemoryFileSystem() }).use(agentCommands());
try {
  const completed = await shell.exec("timeout 1s printf ready");
  console.log(completed.stdout); // ready
  const limited = await shell.exec("timeout .01s sleep 1");
  console.log(limited.exitCode); // 124 after cooperative cancellation and cleanup
} finally {
  await shell.dispose();
}
```

This is a virtual, cooperative deadline, not native GNU timeout, an OS signal,
or hard preemption. The child must honor its supplied signal and settle its
owned cleanup. Blocked host JavaScript, ignored signals, stalled clocks or
nonsettling cleanup can prevent settlement. An ordinary returned child status
is preserved; caller abort and unrelated escaping errors are not rewritten as
deadline success. Existing shell invocation budgets and stream ownership remain.

Durations accept the module's ASCII decimal profile with optional `s`, `m`, `h`
or `d`; mathematical zero creates no deadline resources. Supported duration
range is through `Number.MAX_SAFE_INTEGER` milliseconds. Optional `scheduler`
methods retain their receiver. `maxTimerMilliseconds` is an integer from1 through
2147483647 (default2147483647), bounding each timer chunk, not the total duration.
`invoke` is an optional explicit host fallback, not a subprocess capability.
Native modes `--signal`, `--kill-after`, `--foreground`, `--preserve-status` and
`--verbose` are refused rather than simulated. No native or SafeJS parity is
claimed by the module/public integration. Its leaf README records the earlier
pre-wiring status; this section describes the new root surface, whose different
public review is pending.

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

After `npm run build`, this TypeScript example uses an injected mock transport
and explicit authorization. The `.test` URL is synthetic: no network request,
DNS lookup or external service is used. Run it with the repository's `tsx`
development tool, or compile it with TypeScript before running Node:

```ts
import {
  Shell, agentCommands, createMemoryFileSystem, networkCommands,
  type HttpTransport,
} from "virtual-bash";

const transport: HttpTransport = async () => ({
  status: 200,
  statusText: "OK",
  headers: [["content-type", "text/plain; charset=utf-8"]],
  body: (async function* () {
    yield new TextEncoder().encode("hello from mock\n");
  })(),
  async dispose() {},
});

const shell = new Shell({ fs: createMemoryFileSystem() })
  .use(agentCommands())
  .use(networkCommands({
    transport,
    authorize: ({ url, method }) =>
      method === "GET" && new URL(url).origin === "https://docs.example.test",
  }));
try {
  const result = await shell.exec("curl -fS https://docs.example.test/");
  console.log(result.exitCode, result.stdout);
} finally {
  await shell.dispose();
}
```

The result has exitCode `0` and stdout `hello from mock\n`. For actual HTTP(S),
omit `transport` to use the bundled Node transport and supply an authorizer
appropriate to your service. That enables real network access; the mock example
does not establish deployed-service behavior.

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

The current default aggregate has 78 unique plugin names; optional `curl` and `safejs`
add one each only when explicitly installed. At curl finalization, the committed
aggregate still had 49 names while uncommitted metadata wiring exposed 52 in
the working tree and its built package. That historical build/smoke remains a
moving-worktree result, not an isolated committed-HEAD snapshot. Later metadata
integration does not retroactively change that evidence. Runtime dependencies
remain zero.
The older frozen package audit at `b98e239` retains its 15-export evidence in
`benchmarks/reports/PACKAGE_AUDIT.json`; it is not rescored here. Exact flags,
bounds and unsupported features remain in `src/commands/network/README.md`.

## Grep Aliases and Column

The default aggregate includes `egrep`, `fgrep`, and `column`. `egrep` selects
extended patterns and `fgrep` fixed patterns; the standalone alias plugin owns
its grep implementation and does not require a separately registered `grep`.
Aggregate `regex` settings are passed to standard `grep`, both aliases and `expr`.
Search retains its separate `search.regex` configuration. These worker settings
do not replace the shell's shared budgets or imply one pool across commands.

Root and `virtual-bash/commands/grep-aliases` export `grepAliasCommands`,
`createGrepAliasCommands`, `egrepCommand`, `fgrepCommand`, and `GrepAliasOptions`.
Root and `virtual-bash/commands/column` export `columnCommands`,
`createColumnCommands`, `createColumnCommand`, `ColumnCommandsOptions`, and
`ColumnLimits`. Standalone plugin options retain explicit `replace`; aggregate
`column` omits it, with top-level `replace` authoritative for every family.

```ts
import { Shell, createMemoryFileSystem } from "virtual-bash";
import { grepAliasCommands } from "virtual-bash/commands/grep-aliases";
import { columnCommands } from "virtual-bash/commands/column";

const shell = new Shell({ fs: createMemoryFileSystem() })
  .use(grepAliasCommands({ regex: { maxWorkers: 1 } }))
  .use(columnCommands({ limits: { maxRows: 1000 } }));
try {
  const result = await shell.exec("egrep '^keep' | column -t", {
    stdin: "keep 1\ndrop 2\nkeep 3\n",
  });
  console.log(result.stdout);
} finally {
  await shell.dispose();
}
```

Column buffers bounded tables, preserves VFS/stdin bytes according to its
documented decoding/layout profile, and may emit partial output before an error.
It is not a GNU utility or full BSD/util-linux emulation. Exact flags, display
width, padding and resource bounds remain in `src/commands/column/README.md`;
that module-author document predates this root wiring. Alias source evidence and
the two-case public settlement correction are separately recorded in
`tests/commands/grep-aliases-stress/settlement-v2-independent/REPORT.md`.
Registration is not a whole-product gate or full native-parity claim.
Curl and SafeJS remain explicit opt-ins.

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
and actual-host setup. Scoped timeout/curl/actual-engine companion workflows have
[accepted composed evidence](tests/integration/timeout-curl-safejs-20260828/HANDOFF.md)
with a [separate W05 continuation](tests/integration/timeout-curl-safejs-20260828/w05-literal-v1/HANDOFF.md);
that continuation performs no guest evaluation. This is not acceptance of every
guest lifecycle or replay behavior. Broader actual SafeJS integration remains
open. The upstream
proposal 0c1bfe2 is not approved; isolated patched runs do not establish accepted integration, guest
lifecycle success or replay durability. See the ledger for separate cohorts.

A separate [accepted coherent78 checkpoint](tests/integration/coherent78-safejs-independent-20260828/execution-checkpoints/c78-safejs-20260828-01/REPORT.md)
executes three actual-engine guest workflows in each of installed and moved
packages: six evaluations and30 semantic assertions, including injected curl.
Its controlled deadline returns124 only after held cleanup is released. This is
scoped package evidence, not fresh full-source reconstruction, caller-priority,
reason-identity, global-cleanup or whole-release acceptance.

## Validate

```sh
npm run typecheck:all
npm test
SAFEJS_LOCAL_ROOT=/path/to/poe-code/packages/safejs npm test
```

`typecheck:all` builds production ESM/declarations once, then checks current
source/tests and the maintained strict built-package consumer routes. It does
not execute their runtime programs. `npm run typecheck` reuses an existing
build; without one it stops with an explicit prerequisite rather than unresolved
consumer imports. Use the combined command after source changes: presence of
`dist` alone is not freshness verification. `npm run typecheck:consumers` checks
the consumer routes against an existing build without rebuilding or running
the global source/test check. `npm run build` remains available separately.

Typechecking and default test discovery both omit
`tests/commands/regex-execution/continuation/artifacts/native`, whose `.ts`
names are native glob inputs, not maintained TypeScript. Typechecking additionally
authenticates and excludes exactly five flattened historical tree contract
captures; their original bytes, provenance and replay are retained. Their current
`src/contracts` originals, neighboring TypeScript and current consumers remain
checked. The historical eight capture diagnostics and separate three file-test
annotation diagnostics are preserved, not product failures erased from a run.
See `tests/integration/typecheck-workflow-repair/README.md` for the narrow change
and negative controls. Other artifact trees, tests and helpers are not broadly
excluded; the existing selected-GNU consumer has its own build-first check.

Historical standalone `.mts` omissions remain separate. The qualified inventory
explicitly routes maintained `.mts` consumers, intentional negative-type cases,
and hash-sealed historical captures; new paths still fail closed. Its maintained
`.test.mts` programs execute through that dedicated runner, not `npm test`'s
`.test.ts` discovery. See `tests/plugins/qualified-current-release/README.md` for
the exact census and compile-only external-service limitations.

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

## Bounded HTML conversion

`html-to-markdown` is a default command. Root and the explicit
`virtual-bash/commands/html-to-markdown` subpath export
`createHtmlToMarkdownCommand`, `createHtmlToMarkdownCommands`,
`htmlToMarkdownCommands`, `HtmlToMarkdownCommandsOptions`, and
`HtmlToMarkdownLimits`. Aggregate limits use `htmlToMarkdown`; only the
aggregate's top-level `replace` controls replacement.

```ts
import { Shell, agentCommands, createMemoryFileSystem, networkCommands } from "virtual-bash";

const shell = new Shell({ fs: createMemoryFileSystem() })
  .use(agentCommands({ htmlToMarkdown: { limits: { maxInputBytes: 1024 * 1024 } } }))
  .use(networkCommands({ authorize: request => new URL(request.url).origin === "https://docs.example.com" }));
try {
  const result = await shell.exec("curl https://docs.example.com/page | html-to-markdown > /page.md");
  if (result.exitCode !== 0) throw new Error(result.stderr);
} finally { await shell.dispose(); }
```

Network capability remains explicit and every hop is authorized. HTML conversion
does not fetch images/styles, execute scripts, or access implicit host paths.
The tokenizer/tree renderer handles its documented subset with finite input,
token, depth, work and output limits. Each operand is buffered within those
bounds: this is not constant-memory conversion, an HTML5 browser parser, a
sanitizer, or Pandoc-equivalent output. Link/image title attributes are not
rendered. Unsafe destinations are suppressed by the documented destination
policy; downstream Markdown remains untrusted content.

Pure conversion explicitly enrolls owned stdout operations. Cooperative input
and parser work can stop on downstream closure before the first write; cleanup
is awaited. Diagnostics retain the original caller context, and required file/
header destinations are not canceled merely because an unrelated stdout pipe
closes. Opaque producer/cleanup promises still require host cooperation. This is
a new HTML adoption, not a retroactive pass for the original first-read cohort.
The renderer's independent module acceptance and this new public/lifecycle
integration are separate scopes; integration still requires its different-agent
review. Exact CLI, limits and limitations are in
`src/commands/html-to-markdown/README.md`.

## Bounded usage accounting

`du` is a default command. Root and `virtual-bash/commands/du` export
`createDuCommand`, `createDuCommands`, `duCommands`, `DuCommandsOptions`, and
`DuLimits`. Aggregate options use `du: { limits: ... }`; only top-level `replace`
controls aggregate replacement. Standalone `duCommands` accepts its own `replace`.

```ts
import { Shell, agentCommands, createMemoryFileSystem } from "virtual-bash";

const fs = createMemoryFileSystem();
await fs.mkdir("/project");
await fs.writeFile("/project/notes", new TextEncoder().encode("seven!!"));
const shell = new Shell({ fs }).use(agentCommands({ du: { limits: { maxEntries: 10000 } } }));
try {
  const result = await shell.exec("du -bs /project");
  if (result.exitCode !== 0) throw new Error(result.stderr);
} finally { await shell.dispose(); }
```

The example reports `7\t/project\n`: apparent size, not allocation.

Default allocation mode uses provider-reported `FileStat.allocatedBytes`.
Absence is unknown, not zero or rounded logical size; incomplete totals are
suppressed with status1 and a diagnostic. Use explicit `-b`/`--apparent-size`
when logical accounting is intended. Known zero is valid. Memory/S3/WebDAV do
not fabricate allocation; Real reports validated host allocation when available.
Neither mode measures unique/reclaimable storage, billing, RSS or a snapshot.

The bounded walker uses metadata only, preserves its documented deterministic
ordering and identity qualifications, and never reads stdin or file content.
When stdout advertises the accepted owned-output capability, metadata/output
work uses that operation's signal; validation and required stderr keep the
original caller. One combined stdout/stderr budget remains in force. Closing
stdout does not abort the caller or an unrelated required file destination.
Opaque provider promises are observed but not forcibly stopped or claimed retired.
This is new DU integration/adoption, pending separate public review; the accepted
module, native qualification and frozen HTML74 package remain separate evidence.
Exact flags, refusals and limits: `src/commands/du/README.md`.

## Bounded expressions

`expr` is included in the default aggregate. Root and
`virtual-bash/commands/expr` expose `createExprCommand`, `createExprCommands`,
`exprCommands`, `ExprCommandsOptions` and `ExprLimits`. For example,
`expr 20 + 22 > /answer; cat /answer` returns `42\n` through VFS output.
Quote shell metacharacters when passing expression operators and BRE patterns.

Aggregate `expr` accepts only family `limits`; global `regex` and top-level
`replace` are authoritative. Unknown nested runtime `expr.regex`/`expr.replace`
fields do not override them, even when global regex is omitted. Direct factories
retain their own regex/replacement options. Existing worker defaults do not change.

This initial restricted implementation uses bounded integer/string operations
and worker-only BRE. The live guard refuses backreferences to captures marked by
nullable repetition; it does not reject every nullable capture. Named encoding
profiles have documented collation/bracket restrictions. Normal output quotas
retain a separate fixed34-byte emergency diagnostic, not an absolute combined
output cap. It is not full GNU/POSIX parity, an RSS bound or a realtime guarantee.
Expr consumes argv, not stdin; this wiring adds no owned-output or opaque-input
preemption promise. Required rejection identity and cooperative worker cleanup
remain the accepted module behavior. Public integration requires separate review;
exact profile and limits are in `src/commands/expr/README.md`.
