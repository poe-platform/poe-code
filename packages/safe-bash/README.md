# virtual-bash

A virtual Bash companion to `poe-code safejs`, inspired by `just-bash`.

The requested scope includes Express-like plugins; memory, real,
S3-compatible (with a mock), WebDAV, and additional filesystems; many agent
tools; and piping, stdin, and full shell support.

## Status

**Qualified explicit opt-in Node integration (August 29, 2026):** `nodeCommands`,
`createNodeCommands` and `createNodeCommand` require a trusted qualifying provider.
The exact `virtual-bash/commands/node` subpath and root expose the restricted
NP1-CJS-WRQ-L-SYNC-1 / Worker-L APIs; **default80 does not include Node**.
ROOT accepted public source `bb4dd057` / selected composition `a6d20781` through
independent review `27f557ad`, retaining module `a2f3983d`'s qualifications.
This includes accepted Unit2, not Unit3/Unit4 or the moving worktree; the separate
Unit3 profile acceptance below does not compose it with Node.
No engine is bundled, discovered, installed or imported implicitly; npm/npx and
native evaluation/subprocess fallbacks remain excluded. The static adapter URL and
identity are configuration, not byte authentication or host authorization.

The usage below requires a host-supplied, already authorized adapter and VFS;
the adapter implements the documented default-only engine ABI. Public import,
installation and relocation checks do not authenticate that host-supplied engine.

```ts
import { Shell, agentCommands, createNodeWorkerProvider, nodeCommands } from "virtual-bash";
import type { FileSystem, NodeWorkerProviderOptions } from "virtual-bash";

export async function printRestricted(fs: FileSystem, authorized: NodeWorkerProviderOptions) {
  const shell = new Shell({ fs, cwd: "/" });
  try {
    shell.use(agentCommands());
    shell.use(nodeCommands({
      provider: createNodeWorkerProvider(authorized),
      grants: { stdoutWrite: true, stderrWrite: true },
    }));
    return await shell.exec("node -p '1 + 2'");
  } finally {
    await shell.dispose();
  }
}
```

All seven grants default denied; all24 profile caps are fixed, with no overrides.
Provider `prepare` is synchronous/inert; acquisition belongs to `start`, and owned
retirement/cleanup precedes settlement. The host protocols are not guest authority.
Worker-L may abandon guest continuations after entry return; it is not all-jobs-
settled, full Node/CommonJS, hard RSS or a whole-invocation5s guarantee. `.cjs`,
inline eval/primitive print and noninteractive stdin have a finite synchronous
text/JSON/path profile, not ESM/TLA, package search, local JS require, Buffer,
async FS or `process.exit`. See [module limits](src/commands/node/README.md),
[qualified ROOT acceptance](tests/integration/node-public-independent-20260829/ROOT-ACCEPTANCE.md)
and [independent evidence](tests/integration/node-public-independent-20260829/REPORT.md).
The 942 expected outcomes are not all successful guest commands. W23 diagnostic
detail, E09/partial-family coverage, individual internal-loader exits and universal
process/resource accounting remain qualified; no full Node/Bash or overall-winner
claim follows. Original author/module failures remain preserved.

TypeScript, ESM, Node.js 22 or newer. Runtime filesystem contracts and adapters
come from the required published `poe-code >=13.0.0` peer. The standalone release
profile pins `poe-code@13.0.0`; this private monorepo checkout instead declares
`poe-code: file:../..`, with the root's `file:.` development self-link and one root
lockfile. A `0.0.0-dev` root does not satisfy the published peer range and is never
reported as release 13 qualification. This is a runtime package requirement,
not zero-dependency distribution. The nested historical standalone lock remains
preserved evidence, not a second installation graph.

Checkout tests use the root's public `poe-code/safe-fs` export: runtime identity
comes from `packages/safe-js/dist/safe-fs.js`, while declarations come from SafeFS.
The private SafeFS development edge orders declaration compilation only; it is
not a substitute runtime import. Run the normal root build before runtime gates
so the shared bundle exists; do not replace it with raw SafeFS JavaScript.
The checkout capture profile binds this built public closure without claiming a
packed or published result. A committed export gate requires an explicit
`S3_HTTP_EXPORTS_PEER_ARTIFACT` root tarball matching the selected root metadata and
built public closure. Its integrated private-package install bypasses peer-range
resolution explicitly, not by changing the development version or satisfying
`>=13`; the registry-release profile still requires the exact 13.0.0 artifact SRI.
The existing filesystem subpaths are compatibility re-exports of
`poe-code/safe-fs`, not independently bundled implementations. Shell and injected
SafeJS hooks must resolve one installed canonical module graph. Independently
bundled consumers must externalize that public route or share its emitted chunk.
`makeSafeJsFsModule` now passes the original `{ adapter, cwd?, signal? }` to its
explicitly injected factory. Use the public `makeFsModule` from the installed
`poe-code/safe-js` peer, or a compatible host factory; legacy `{ fs }`-only factory
stubs must migrate. This helper does not load or install a SafeJS engine.
The legacy `poe-code/safejs` SDK route remains an identity-preserving alias.
WebDAV request streaming in 13.0.0 fails with `ENOTSUP` before source access or
I/O for undeclared custom fetch functions. Exact current-realm native fetch is
probed automatically; a faithful native wrapper may explicitly declare
`requestStreamSupport: "native"`, and a faithful custom streaming transport may
declare `requestStreamSupport: true`. Neither declaration authenticates a
wrapper or grants filesystem comparison authority. Do not opt in a transport
that stringifies or otherwise corrupts streaming request bodies.
Development uses
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

**ROOT-qualified public80 acceptance (August 29, 2026):** the exact candidate
`c83f352f057c64917f219eb938f54aa42cdab829`, full 950-member package SHA256
`4671ed60875c87f8cc32b735fde5d9b57301f427ecd5a376ad1123afb951e156`, adds only
`git` to the accepted 79 defaults. The
[root acceptance](tests/integration/git-public-independent-20260829/root-acceptance/ROOT-ACCEPTANCE.md)
combines 336 retained passes and 11 novel passes per layout with one separately
versioned I03-v2 pass per layout: all 12 novel properties through **two cohorts**,
not a single all-green run. Six type groups, 83 maintained cases, 21 moved-consumer
cases and nine loaded controls are separate proof categories. Original three I03
failures/exit one, author obsolete-export failures and the old public79 worker-denied
79/83 remain unchanged. This accepts the finite read-only Git profile, not live
HEAD, later `|&`/`&>` changes, Node, full Git/Bash, hard RSS or an overall comparison win.

**ROOT-qualified redirectionUnit1 acceptance (August 29, 2026):** source
`1e9b83d73ca6efcf84e4cb0a0b20d81f71da237e`, derived
`ed0e0d09cf71bed7f4aee075750b60a30df4ef52`, full950 package SHA256
`e0e63b0319f0b7b77e68a6e6284021bd747c60ce9f93291a5090048fa835e296`
adds finite `|&` / `&>` support on the exact public80 base; default80 is unchanged.
The [qualified acceptance](tests/compatibility/bash-redirection-independent-20260829/root-acceptance/ROOT-ACCEPTANCE.md)
binds60 version-qualified identities per layout (48 author-v2 +10 unchanged novel
+N06-v2 +N11-v3),103 retained and93 pack outcomes per layout, maintained83,
moved21 and separate type/mutant controls. Original author/bootstrap/N11 failures
and stale M1A139/140 remain literal; accepted public80's corrected export fixture
supports SOURCE interpretation, not a new140/140 run. Inherited SOURCEONLY/MIXED,
loader/Worker and AST-cloning limits remain. No native Bash/GNU-byte parity,
full Bash, strict-mode, Node, live-HEAD or global-gate acceptance follows.

**ROOT-qualified strict-mode Unit2 resolved profile (August 29, 2026):** source
`928be5585f05c15867fbbb5f4b5debe153b0734e`, derived
`26215b99cb379a9f825f803454f758fab5a3c8e9`, full950 SHA256
`1fafce728b6346db4555449ba6259694346983d877a32e917fd7a15c6ebe64e4`
is accepted on exact public80 plus accepted Unit1; default80 remains unchanged.
The resolved profile covers signed `e`/`u` option clusters, supported terminal
`o` forms, nounset off by default, lazy presence-sensitive expansions and
scope-boundary fatal unwinding while preserving existing errexit/pipefail rules.
Independent evidence passes 50 author +16 novel +151 regressions per layout
(651 across source-build/installed/moved), with separate type and loaded controls.
Eleven design IDs remain open: arithmetic nounset, aggregate lengths, invalid-option
partial mutation and exact GNU diagnostic/status/line bytes are unqualified.
Fatal status1 is provisional project policy, not a native golden. No complete
strict-mode/full-Bash, native, live-HEAD or Node acceptance follows. See the
[exact ROOT acceptance and inherited limits](tests/compatibility/bash-strict-mode-independent-20260829/ROOT-ACCEPTANCE.md).

**ROOT-qualified conditional Unit3 profile (August 29, 2026):** exact source
`7a5c620005fb04518d44bb284f4e99284e4a7c33`, derived
`74dfe69135a3fc5ba89396b20dd32d9c9daae131`, full954 SHA256
`46a845f6c12933308aef11dbbf8f861afcc38ff9973b83bcccea13c3329c0a09`
adds a separate `[[ ]]` AST with lazy visited expansion, no IFS/pathname globbing,
quote-aware C basic patterns, limited numeric literal comparisons and typed VFS
error handling. `-v` supports scalar/canonical numeric indexes only. Reached ERE,
unsupported extglob/aggregate predicates/timestamps remain refusals, not GNU passes.
Private4096-node/depth64 grammar caps use `ShellSyntaxError`; actual resource,
caller, sink and cleanup contracts are separate. The
[qualified acceptance](tests/compatibility/bash-conditional-independent-20260829/ROOT-ACCEPTANCE.md)
maps840 version-qualified outcomes (831 original positives +9 fresh), **not one840
rerun**:67 author +201 retained +12 novel per layout. Types, mutation pairs and
binding refusals remain separate; original failures and source/loader/AST/census
limits are retained. Default80 and prior core/opt-in Node acceptances are unchanged.
No native GNU5.3/full-Bash, coherent Node-plus-Unit3, Unit4, live-HEAD or global-gate
acceptance follows.

**ROOT-qualified Unit4/N14 source and semantic profile (August 29, 2026):** source
`7196bace8ea2c141d5ed1020fef5bf721c321ace`, selected
`bf079ada185a79aec864b068f3738ddc5520822e`, full954 SHA256
`3f3ae85116f12ab4354a6103c0c95e967c4e88bd2eb133e63236148a2734af49`
extends the accepted core with evaluated-scalar arithmetic nounset, incremental
supported `set` option mutation, the three-option listing/replay subset, and
diagnostic-failure propagation through an **exact, non-async returned invocation
Promise**. Transformed/async promises are outside that N14 guarantee; raw falsy
identity and caller/cleanup priorities remain intact. Default80 is unchanged.
The basis is744 literal outcomes plus separate type/mutation/binding evidence;
**the old campaign remains CLOSED/noncompliant** because expected package hash
admission followed inflation. Package/loader identity was verified before consumer
execution. A separate12-control prospective proof and one authenticated954-member
parse correct the admission gate without rerunning or rescoring those outcomes.
This is bounded source/semantic acceptance, not a compliant old end-to-end run.
Five design IDs and native parity remain open; no full GNU listing/status, Bash,
Node-plus-Unit4, live-HEAD or global-gate claim. See
[the exact acceptance and limits](tests/compatibility/bash-strict-extension-independent-20260829/n14-v2/ROOT-ACCEPTANCE.md).

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
`curl` is an explicit network plugin. The qualified frozen public80 composition
includes accepted `apply_patch` and read-only M1A+M1B `git`, with root/subpath APIs
and exactly 80 defaults. Git keeps all 24 fixed numeric caps and its declared
storage/configuration/format refusals; packed support is bounded, not full Git
compatibility. Restricted Node now has qualified public opt-in acceptance with an
explicit trusted provider; it is not a default command or full Node compatibility.
This status does not certify the moving worktree.
`safejs` is not Node, and `patch` is not `apply_patch`.
“Without the npm stuff” excludes npm/npx product commands only; npm, Node and
TypeScript development tooling remain. The counts in that table are supplied by
the user, not independently verified usage statistics or completeness scores.

The historical [Git M1A type adjudication and scoped assessment](tests/commands/git-independent-20260828/m1a-type-adjudication-v15/TYPE-ADJUDICATION.md)
binds 284 unmodified semantic groups (71 each across source, compiled, offline
installed and moved layouts), four original type passes plus the separately
observed exact missing-export negative, and three loaded-mutant detections,
three restores and three binding refusals. These are separate proof categories,
not a new aggregate type score or global green gate. Historical failing exits
remain unchanged. Private-writer joins are source-qualified; closed-stream and
registration observations do not establish native allocation/RSS bounds.
That earlier M1A-only loose-object/index profile refuses packed-object storage and other
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
executable lookup (`which`), cooperative deadlines (`timeout`) and VFS editing
(`apply_patch`) and read-only Git (`git`), totaling 80 unique registered
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

The current default aggregate has 80 unique plugin names; optional `curl` and `safejs`
add one each only when explicitly installed. At curl finalization, the committed
aggregate still had 49 names while uncommitted metadata wiring exposed 52 in
the working tree and its built package. That historical build/smoke remains a
moving-worktree result, not an isolated committed-HEAD snapshot. Later metadata
integration does not retroactively change that evidence. Runtime dependencies
remain zero.
The older frozen package audit at `b98e239` retains its 15-export evidence in
`benchmarks/reports/PACKAGE_AUDIT.json`; it is not rescored here. Exact flags,
bounds and unsupported features remain in `src/commands/network/README.md`.

## Apply Patch

The current aggregate includes `apply_patch`. Root and
`virtual-bash/commands/apply-patch` export `createApplyPatchCommand`,
`createApplyPatchCommands`, `applyPatchCommands`, `ApplyPatchCommandsOptions`
and `ApplyPatchLimits`. Standalone registration is also available; do not install
it twice without intentional replacement. Aggregate `applyPatch` accepts limits
only, with top-level `replace` authoritative, including untyped nested overrides.

`apply_patch` accepts one literal patch argument or UTF-8 stdin. This is the
`*** Begin Patch` / `*** End Patch` Add/Update/Delete/Move format, not a native
`patch` subprocess or general GNU/unified-diff compatibility. Matching is literal
and bounded. Parent traversal, symlink targets and binary/NUL input are refused;
paths are VFS paths, never implicit host paths. Limits may be lowered, not raised
past the module maxima. Validation/staging does not promise multi-file rollback
or atomic publication across providers; filesystem or output failures can follow
completed writes. Required diagnostics use the caller's stderr, and cooperative
cleanup is awaited before public settlement.

```ts
import { Shell, MemoryFileSystem, agentCommands } from "virtual-bash";

const shell = new Shell({ fs: new MemoryFileSystem() }).use(agentCommands({
  applyPatch: { limits: { maxPatchBytes: 65536, maxFiles: 8 } },
}));
try {
  const patch = "*** Begin Patch\n*** Add File: note.txt\n+hello\n*** End Patch\n";
  const changed = await shell.exec("apply_patch", { stdin: patch });
  if (changed.exitCode !== 0) throw new Error(changed.stderr);
  const content = await shell.exec("cat note.txt");
} finally {
  await shell.dispose();
}
```

The module at `753f33d2` has ROOT-qualified acceptance; the frozen coherent78+arrays
public/default79 baseline has separate qualified acceptance `bd772916`, inherited
by the exact public80 composition above, not by arbitrary later source changes.
Historical L07's7/9 includes two unchanged cleanup-count assertion failures: two
distinct registered owners fulfilled, not the fixture's expected one. Legacy11
failures and21 uncredited observations retain their original qualifications. See
[the module adjudication](tests/commands/apply-patch-independent-20260828/u12-l07-continuation-v1/ACCEPTANCE-ADJUDICATION.md)
and [the public integration evidence](tests/integration/apply-patch-public-20260829/).
Curl/SafeJS stay explicit opt-ins. No whole-product or
full native-utility parity follows from this integration.

## Read-only VFS Git

The ROOT-qualified frozen public80 wiring adds only `git` to public79. Root and
`virtual-bash/commands/git` export `createGitCommand`, `createGitCommands`,
`gitCommands` and `GitCommandsOptions`. Aggregate `git` accepts
`discoveryBoundary`; top-level `replace` wins over untyped nested replacement.
Direct factories retain their own replacement setting. There are no numeric
Git limit overrides; unknown module options are refused.

```ts
import { Shell, MemoryFileSystem, agentCommands } from "virtual-bash";

const fs = new MemoryFileSystem();
const shell = new Shell({ fs, cwd: "/repo" }).use(agentCommands({
  git: { discoveryBoundary: "/repo" },
}));
try {
  const status = await shell.exec("git status --porcelain=v1");
  const tracked = await shell.exec("git ls-files | head -n 10");
} finally {
  await shell.dispose();
}
```

This reads supplied VFS repositories, never the host checkout. It supports a
bounded `.git` directory/bare, SHA-1/index-v2/loose/packed-ref/pack-v2/idx-v2
profile, including verified OFS/REF deltas, status, selected diff/log/show,
rev-parse and ls-files forms. See `src/commands/git/README.md` for the exact
grammar, text domain, config allowlist and storage refusals. Gitfiles/linked
worktrees, shallow/promisor/alternates, thin packs, write commands, hooks, filters,
network, native subprocess fallback and arbitrary config are not supported.
All packs are eagerly verified, including metadata queries. Fixed cumulative
read/inflate/work budgets can refuse otherwise valid repositories far below the
individual pack-size cap; this is not general packed-repository readiness.
Logical resident accounting is not a hard RSS bound or opaque-provider preemption.

Populate `/repo` with genuine Git files through the VFS before running the example.
ROOT-qualified M1B module `fca6f81d`, consolidated in `db8b818d`, retains
S02/H09/private-writer source gaps, nonexhaustive resource mappings and six unrun
native workflows. The79 apply-patch baseline has bounded public acceptance
`bd772916`; its four RegexWorker-denied reviewer regressions remain unqualified,
not proven product failures or passes. The new80 composition still requires its
own public review; module acceptance alone does not accept it. Author evidence is in
`tests/integration/git-public-20260829/`. No full Git/GNU or whole-product claim.

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

### Current imported-feature validation

The current imported-feature operation uses the guarded build, test and typecheck
routes plus actual committed-archive and packed-export consumer validation. The
archive owner is `tests/integration/s3-http-exports/verify.mjs`; its discovered
`exports.test.ts` launcher selects `S3_HTTP_EXPORTS_REVISION` (default `HEAD`).
The selected revision must be an actual commit containing `packages/safe-bash`
and the authenticated root/package prerequisites. Staged files and a source-parent
commit do not qualify. Synthetic committed fixtures test this verifier, not the
actual integrated candidate.

From this package directory, the supported validation commands are:

```sh
npm run build
npm run test:unit
npm run typecheck
```

Use Node.js 22 or newer, the workspace development dependencies and the qualified
native prerequisites/environment. The test route includes the committed-archive
launcher; select its actual integrated commit with `S3_HTTP_EXPORTS_REVISION`.
Missing prerequisites and validation failures remain failures, not release
approval. The commands above do not establish that any gate has already passed.

Current releases also require the full current export-consumer checks, retaining
all declared runtime, strict-type, negative-type and source-fallback assertions.
Their maintained authorities include `scripts/verify-current-consumers.mjs`,
`scripts/typecheck-consumers.mjs` and the qualified-current-release
`consumers.mjs`/`runtime-coverage.mjs` definitions. The narrower archive fixture
below does not replace these requirements or establish that those checks passed.

Immediately after its isolated build, the verifier captures one immutable full
`dist/` regular-file inventory bound to the selected source commit and source
archive SHA256. Records contain literal `dist/`-prefixed paths and content SHA256,
sorted by full-path JavaScript string order, not locale or directory traversal
order. The copied tree, packed member set and installed tree must equal that
original inventory; expected records are not recaptured from later outputs.
Installed bytes are checked before runtime imports, strict public type consumers
and the retained negative type controls. Final checks cover all three trees.
The runtime fixture covers the package root and S3 HTTP exports, source-fallback
refusal and zero HTTP requests; it is not every exported feature's runtime test.

Inventory admission checks literal spelling, held-source counterparts, case aliases,
regular ancestors and file kinds before content reads. It bounds the tree to
10,000 entries including directories, 64 path components, 4,096 pathname bytes,
32 MiB per file and 128 MiB total file bytes. Empty directories and file modes
are not content records. This establishes continuity of one selected build, not
reproducible-build equivalence, arbitrary hostile-filesystem race resistance,
service acceptance or a completed candidate qualification before that gate runs.

Maintenance decision: `npm run verify:release:whole` is retired. Its diagnostic
alias exits 78 for every invocation, writes only the retirement message to stderr,
and performs no legacy imports, Git/native work or output creation. It runs no
validation and never forwards old arguments to a replacement gate.

The alias previously selected the fixed b494 preflight/550-test protocol, not
`tests/integration/full-gate-20260827/unified76-driver/launcher-v3`. That separate
launcher fixes the f5e9 candidate, 632 canonical tests and its historical native,
private-engine and consumer obligations. Both protocols remain archived evidence,
not maintained release entrypoints; their original bytes, policies, pins, fixtures
and failed outcomes are preserved. The known launcher-v3 `execute.mjs:137` unbound
`manifest` call remains unrepaired.

Launcher-v3 is also retired as current maintained manual-gate tooling, including
its preserved standalone launcher, worker and review dispatch paths. Its40-member
protocol remains executable historical tooling, not passive fixture data or a
supported current validation command. No replacement driver or historical fork
is introduced by this retirement.

The supported current gates are not equivalent replays of either protocol and do
not certify every historical obligation or all 29 exported feature runtimes. The
archive fixture retains the root/S3 HTTP and strict/negative consumer scope
described above. Retirement alone is not a blanket lint waiver. The separate
`archived-operational-tooling` inventory record classifies exactly28 literal JS
programs through the pinned DRIVER owner and exact selectors. It excludes neither
the two consumer fixtures nor the ten non-JS protocol members, current selectors
or outward dependencies. Do not infer further exclusions from that record or
reinterpret preserved historical failures as fixed bugs or passing gates.

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

### Guarded production build

The package build retains the dist guard and integration metadata check, then runs
`node scripts/build.mjs` instead of raw `tsc -p tsconfig.build.json`. The runner
uses the existing held-path policy before discovery and compiler reads; its
explicit root names come from guarded TypeScript config matching, not an
unguarded glob. Transitive imports, paths mappings and declaration references
pass through the same host. Held subtrees are pruned; held case aliases and
symlink/hardlink inputs are refused before payload reads. Boundary-owner
authentication is preserved. This does not change source or retire any inputs.

Compiler/declaration tooling remains trusted: the installed TypeScript library,
hoisted `@types/node` and `undici-types` declarations/package metadata. Other external
source reads are unavailable. Compiler options such as `--listEmittedFiles`,
`--noEmit` and `--emitDeclarationOnly` are retained; output stays under `dist`.
Nonempty project references are refused after configuration parsing, before
source payload reads or emission; referenced targets are not opened. Empty or
absent reference lists retain the normal one-shot behavior.
The route is a one-shot build, not a full tsc CLI replacement: response files,
watch/build/incremental modes, configuration/help/version-only modes and
profiling/diagnostic-statistics/locale CLI modes are refused rather than silently
executed. Semantic diagnostics remain enabled according to the existing config.
The maintained `test:runner` explicitly selects `scripts/build.test.mjs`;
`test:unit` runs these controls before the runtime suite.

This host assumes a stable trusted POSIX checkout/toolchain. Descriptor identity
checks and cleanup are not an atomic filesystem sandbox or transactional emit.
Direct raw tsc and the separate typecheck build helper do not inherit this host;
this change makes no admission claim for those routes. Owned memory-fixture
controls do not qualify a production build; independent review and a separately
authorized production run remain required.

### Named imported verification-tool retirement

On August 30, 2026, the root coordinator withdrew current maintenance support
for exactly the789 literal verification-tool members listed in
`integration-lint-audit/import-697ad-verification-retirement.json`. This is a
root maintenance decision, not a user-authored statement. It supersedes the
UNKNOWN-active default only for that named set. The tools remain executable
historical verification/evidence protocols, including negative validation; they
are not relabeled passive data. Original source/history bytes, failed parser
captures and the UF01 historical copy-authority gap remain unchanged. The1217
retained C errors are archived diagnostics, not1217 fixed bugs.

The receipt binds the original imported commit/tree/blob tuples, affirmative
purpose, accepted current-equality evidence and this present support decision.
Runtime admission authenticates the pinned receipt and current member bytes; it
does not prove Git ancestry, purpose, nonuse, purity or harmlessness. The first
authorized667 proof, qualified108 and qualified39 contribute645+105+39 matches;
the unauthorized667 replay contributes none.

Selection remains UNKNOWN:1373 package roots were visited, two workspace
declarations were NOT_COLLECTED, and182703 gaps remain. Any later concretely
demonstrated current dependency requires reopening that member's disposition.
The25 excluded members (two selected helpers,21 runtime implementations and two
composites),655 current tests,36 consumers, current negative validators, public
and build surfaces, and outward dependencies remain active.

The root coordinator separately approved exactly the five literal overlaps and
seven predecessor-record associations in `decision.fiveOwnerException` in the
receipt. These five retain CURRENT byte-authenticated provenance/data-owner
duties while their standalone historical executable-tool maintenance and
file-wide lint role retire. This deliberately changes the previous owner-exclusion
protection for these five; it is not unchanged lint coverage. Within the owned
`verifyLintInventory` loader, their bytes are authenticated, not parsed or executed
as code. Receipt authentication and validation precede their reads; seven binding
uses (including three for `freeze.mjs`) deduplicate to five owner authentications,
followed by five member authentications. All seven relationships remain required.
Other retirement-owner overlaps remain rejected; pre-existing independently owned
immutable-capture admission is unchanged. This is not a global nonexecution claim.
Any demonstrated current executed-validator dependency reopens disposition;
outward protected dependencies remain active.

This exact inventory decision preserves the25 root boundary receipts and all
three frozen-style contracts. It waives no runtime, type, consumer, archive, pack
or release gate. Supported current gates and full current export-consumer checks
remain required and are not equivalent replays of the retired protocols.

Separate present-root style decision: exactly34 `no-unused-vars` tuples in22
protected files (20 copied runtime implementations and two composites) receive
exact owner-bound diagnostic acceptance under `import-697ad-protected-style.json`.
These files remain active and byte-unchanged; this is not historical freezing,
retirement, harmlessness or broad semantic-defect acceptance. The three prior
contracts and four acceptances remain unchanged. The new style processors retain
suggestions via `supportsAutofix: true`; the guarded runner remains `fix: false`,
rejects fix flags, and native `--fix` is not authorized.

A separate root decision accepts exactly two characterized intent diagnostics in
`tests/shell-stress/env-replacement/output-budget-evidence/safe-bash-env-output-baseline-runtime.mjs`:
the lazy-EBADF generator (`require-yield`,197:53) and one-level `ExecutionFailure`
unwrap (`no-ex-assign`,457:17). The runtime remains active and byte-unchanged;
diagnostic IO, original falsey identity and cancellation remain required. This is
not a broad semantic waiver or parity claim. Prospective compatibility accounting
is40 contract-derived acceptances:38 style and two intent, not40 directly suppressed
raw diagnostics and not all style. These are separate from the1217 archived-not-
fixed diagnostics. Neither decision establishes an integrated or release gate pass;
uncovered semantic findings remain blocking.

## Native build qualification infrastructure

`scripts/provision-test-native-oracles.mjs` is test infrastructure, not a shell
command or a runtime dependency. It never installs tools globally. Its explicit
`--parent <absolute-private-directory>` and `--destination <absolute-path>`
options reject omitted, repeated and unknown arguments. The Linux mode accepts
only the fixed Ubuntu 24.04/x64/GCC 13.3 profile and installs verified copies into
this workspace's private `tmp/native-gnu` destination. Caller/CI rollout remains
separate; adding the provisioner does not enable a native fallback in the shell.

The additional `--qualify-darwin-build` mode is an observation-only, trusted-main
GitHub-hosted job. Dispatch the existing Release workflow with
`qualification=darwin-gnu-build`. It requires the reviewed macOS image and Apple
identities, Node 22, an exact resolved checkout, and a mode-0700 parent directly
under `RUNNER_TEMP`; its destination is `<parent>/build`. It authenticates fixed
GNU sources and signatures and builds coreutils twice independently. New output
hashes remain unreviewed observations, not automatically admitted profiles.

This mode validates `GITHUB_REPOSITORY`, `GITHUB_REF`, `GITHUB_EVENT_NAME`,
`GITHUB_SHA`, `GITHUB_RUN_ID`, `RUNNER_ENVIRONMENT`, `RUNNER_OS`, `RUNNER_ARCH`,
`ImageOS`, and `ImageVersion`. `RUNNER_TEMP` bounds private storage and
`GITHUB_OUTPUT` receives the sealed-artifact status. The workflow supplies a
private `HOME`/`TMPDIR` and explicit `PATH`; build children receive only private
paths, C locale, UTC, and the manifest's `SOURCE_DATE_EPOCH`. No ambient secret
environment is retained. Bounded source/signature/build-log/selected-binary
evidence is retained for 14 days, excluding keys and private homes.

See `docs/plans/darwin-gnu-build-qualification.md` for authentication, output
bounds and the still-required genuine Darwin calibration gates. Historical
Apple records and native assertion bodies are unchanged; this qualification
mode alone does not establish release readiness.
