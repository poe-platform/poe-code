# op command implementation

Private internal workspace supporting the explicit virtual-shell plugin exported
by `poe-code/safe-bash/commands/op`. It is not a separately installed or
published `@poe-platform/op` product and does not register an OS `op` executable.
The compatibility target is 1Password CLI 2.39.0, not a claim of full parity.

## Use with safe-bash

Register it explicitly, like other optional command plugins:

```ts
import { Shell, createMemoryFileSystem, standardCommands } from "poe-code/safe-bash";
import { opCommands, createObjectBackend } from "poe-code/safe-bash/commands/op";

const backend = createObjectBackend({
  defaultVault: "demo",
  vaults: [{ id: "demo", name: "Demo" }],
});
const shell = new Shell({ fs: createMemoryFileSystem() });
shell.use(standardCommands());
shell.use(opCommands({ backend, authorize: () => "allow" }));
try {
  await shell.exec("op item create --category LOGIN --title Example username=alice");
  const result = await shell.exec("op item get Example --fields username | cat");
  if (result.exitCode !== 0) throw new Error(result.stderr);
  console.log(result.stdout);
} finally {
  await shell.dispose();
}
```

The result contains `alice\n`. This example was executed unchanged against the
isolated installed root archive and exited zero. No credentials or 1Password configuration are
needed. `op` is not automatically included in standard/agent commands, and
there is no native CLI fallback or implicit host credential discovery.
The unconditional allow policy is only a simple synthetic example; use a
restrictive policy for sensitive operations.

`opCommands(options): VirtualShellPlugin` and
`createOpCommand(options): CommandDefinition` are exported alongside
`createObjectBackend` from the same plugin subpath. Here `createOpCommand`
is the fully composed shell adapter, not the internal low-level dispatcher.

`OpCommandsOptions` extends the internal `OpCommandOptions` documented below:
required `backend`, policy callbacks/mode, handlers, version and channel, plus
`replace?` (default false), `authentication?`, `pluginScope?`,
`confirmPluginClear?` and `selectPlugin?`. Existing `op` registration fails
unless `replace: true` is explicit. Importing the plugin does not register it.

## Generic object seed

Start with an ordinary `OpObjectBackendOptions` object. Vaults use `{ id, name }`;
items refer to them with `vault: { id }`. For example, add
`items: [{ id: "example", title: "Example", vault: { id: "demo" }, fields:
[{ id: "username", type: "STRING", value: "alice" }] }]` to the seed.

Optional `defaultVault` is an existing vault ID and persists in snapshots.
Item creation precedence is explicit `--vault`, input `vault`, configured
default ID, then the sole vault in the selected scope. Missing/ambiguous
selection fails instead of guessing Private. The document handler now defers
omitted vault selection to the same backend contract; its correction is reported
frozen; the subsequent production report records 850 op tests and 10 plugin tests.
Objects/snapshots are plaintext, not an encrypted vault or native account config.

## Virtual host boundary

Files resolve against the virtual shell's current directory and supplied VFS,
not implicit Node filesystem access. Reads require VFS read permission and are
bounded to 16 MiB. Writes require write, permissions and exclusive-create
capabilities, default to mode `0600`, and initially use exclusive creation.
Explicit overwrite additionally requires stat/chmod and a regular file; this
adapter supplies no automatic overwrite prompt or OS identity/atomicity promise.

`op run` and child snapshot restoration use the shell's nested invocation
capability, preserving cwd, stdin, cancellation, replacement environment and
masked output sinks. They do not spawn a native process; child commands must
be available to the virtual shell. Host-provided backends/hooks remain trusted
code. The shell adapter does not read `OP_BACKEND_FILE`/`OP_BACKEND_MODULE`
or install the internal Node SSH key-generation/format-conversion host automatically.

Approval semantics below remain applicable: denial precedes operation input
reads; resolved approval requires backend support and binds prepared object
targets. VFS operations additionally obey filesystem capabilities. The plugin
does not provide `restoreEnvironment` for mutating the parent shell environment;
child execution and emitted shell-source restoration remain distinct paths.

## Internal implementation reference

The remaining SDK/Node sections document internal workspace interfaces for
maintainers, not additional public installation entrypoints. The portable SDK
does not discover Node files or start processes; the separate internal Node host
is not used by `opCommands`. Core secure randomness/OTP use conditional
`#op-crypto`: Node selects `node:crypto` Web Crypto, while browser/workerd selects
the host's `globalThis.crypto`. Missing required secure browser primitives fail
closed at module initialization; there is no weak randomness fallback.

## SDK

```ts
import { createObjectBackend, createOp } from "@poe-platform/op";

const backend = createObjectBackend({
  vaults: [{ id: "demo-vault", name: "Demo" }],
});
const command = createOp({
  backend,
  authorize: request =>
    request.resource === "vault" && request.action === "list" ? "allow" : "deny",
});
const output: Uint8Array[] = [];
const errors: Uint8Array[] = [];
const result = await command.execute({
  args: ["vault", "list", "--format=json"],
  env: {},
  signal: new AbortController().signal,
  stdin: (async function* () {})(),
  stdout: { async write(bytes) { output.push(bytes.slice()); } },
  stderr: { async write(bytes) { errors.push(bytes.slice()); } },
});
```

`execute` returns `{ exitCode }`. Stdin is an async iterable of byte chunks;
output sinks implement `write(Uint8Array): Promise<void>` and may expose `isTTY`.
No output or credentials are implicitly logged by this example.

### Command configuration

`createOp(options)` composes built-in handlers. `createOpCommand(options)` is
the lower-level dispatcher; it does not compose all those handlers for you.

| Option | Meaning |
| --- | --- |
| `backend` | Required `OpBackend`; `execute(request, context)` returns a promise of the result. |
| `authorize` | Returns `allow`, `deny` or `ask`, synchronously or asynchronously. Omitted means direct allow, not default deny. |
| `approvalMode` | `resolved` by default for `ask`; explicit `literal` opts into legacy selector-only approval. |
| `authorizeResolution` | Grants metadata/input preparation for resolved `ask`; not execution approval. |
| `approveResolved` | Approves the frozen resolved target/effect description. |
| `approve` | Legacy callback, used for `ask` only with explicit literal mode. |
| `handlers` | Trusted overrides keyed by canonical command path. Resolved handlers need a preparation contract. |
| `version` | Reported package version override, not a change to the upstream compatibility target. |
| `channel` | `stable` default; `beta` enables the modeled beta surface. |

`OpCommandContext` requires `args`, `env`, `signal`, `stdin`, `stdout`, `stderr`.
Optional capabilities/configuration are `authentication`, `pluginScope`,
`confirmPluginClear`, `selectPlugin`, `readFile`, `writeFile` and `invoke`.
The `binding` slot is internal; the public command discards caller-supplied
handles. `EnvironmentCommandContext` additionally accepts `restoreEnvironment`.

### Object backend configuration

`defaultVault?: string` is an existing vault ID, matched case-insensitively and
stored canonically. Snapshots retain it; removal of that vault is rejected.

`createObjectBackend(options)` accepts:

| Option | Meaning |
| --- | --- |
| `vaults`, `items`, `documents`, `accounts` | Explicit seed records. Items reference a vault; document content may be bytes. |
| `resources` | Additional named collections, including account-scoped plugin configuration, sessions and injected `item template` schemas. |
| `adminHooks` | Trusted callbacks keyed by canonical command path for host-dependent operations. |
| `authentication` | `{ mode: "object-store" }` default or `{ mode: "managed" }` for modeled session admission. |
| `clock` | `{ now(): number }`, milliseconds since Unix epoch; defaults to the host clock. |
| `ssh` | `generate(type)` and `transform(source, format)` capabilities; Node supplies implementations. |

Account-owned records use `account: "id"` or `{ id: "id" }`; items/documents can
inherit ownership from their vault. Multiple-account operations need an
unambiguous account selection. Hooks receive detached requests/scoped resources
and may return `value`, resource updates and typed authentication effects. A
hook's success does not prove remote provisioning or expiry enforcement.
`snapshot()` returns detached state, not encrypted storage or a credential backup.

Managed authentication uses explicit session records and injected time. Manual
sessions have a 30-minute inactivity limit; app authorizations have a 10-minute
inactivity and 12-hour hard limit. Session admission is separate from host policy.
Execution `authentication` accepts `terminalId` and trusted `integration:
"manual" | "app"`; absent mode defaults to manual. No mode is inferred from
session existence. App preference is shared within backend state; manual
preference is terminal-scoped. Missing app preference requires explicit account
selection even with one account; these local preference transitions are not
fully verified native behavior. Explicit `--account` overrides `OP_ACCOUNT`.

## Approvals and security boundaries

Denial occurs before command input acquisition and backend work. Help and
completion are backend-free paths. `--force`, `--raw`, `--reveal` and
`--no-masking` never bypass central policy. Trusted module bootstrap is separate
from this command-effect boundary.

Resolved `ask` requires both approval stages and backend `prepareBinding`,
`validateBinding`, `cancelBinding` capabilities. Missing capabilities fail
closed, without fallback to literal mode. Preparation fixes IDs, account/backend,
mutation and effect intent; stale state invalidates the approval. The object
backend uses coarse generation invalidation, a default 60-second binding
lifetime and at most 1,024 planned requests within one account scope.

The frozen `OpResolvedApproval` contains operation, backend/account IDs, targets,
option names, mutation names/batch size, output kind/destination and optional
child executable/argv/environment names. Every child argument is `[redacted]`;
secret values and private binding handles are excluded. Initial literal policy
and resolution callbacks still receive raw arguments/flags: do not log them as
safe metadata. Names and destinations can also be sensitive.

Supported object operations pin targets; hooks, unsupported dynamic dependencies
and other capability gaps fail explicitly. File-backed Node resolved approval
is unsupported without a persistent revision/writer contract. Direct allow and
explicit literal file-backed operation remain available without the stronger
guarantee. No OS inode/executable-content identity, remote transaction, or
atomic control after host handoff is promised. Snapshot version 1 is a format
version, not a mutation revision.

Plaintext read/inject/run output is intentional. Human item output conceals
sensitive fields unless revealed; JSON and selected-value output may disclose
them. Run masking is best effort across streams, not prevention of a child's
transformed output or network transmission.

## Internal Node host configuration

`runOpCli(args, dependencies?)`, from `@poe-platform/op/node`, returns an exit
code. The Node subpath also exports `generateSshKey` and `transformSshKey`.
The complete `NodeHostDependencies` option groups are:

| Options | Meaning/default |
| --- | --- |
| `authorize`, `approve`, `authorizeResolution`, `approveResolved`, `approvalMode` | Policy configuration described above. Mode has no environment or module-export override. |
| `fs` | Inject `readFile`, `writeFile`, `rename`, `unlink`, `open` and optional `constants`; defaults to Node filesystem APIs. |
| `spawn`, `loadModule` | Process/module capabilities; defaults to Node process spawning and module import. |
| `cwd`, `version` | Working directory and version override; defaults to process cwd and package version. |
| `env`, `stdin`, `stdout`, `stderr` | Explicit environment/streams; defaults to process values. Undefined environment entries are omitted. |
| `signal` | Cancellation; when absent the adapter handles SIGINT/SIGTERM. |
| `authentication` | Trusted terminal/integration context. |
| `pluginScope` | Optional `cwd`, `home`, `terminalSession`; missing paths use host cwd/OS home. This does not discover credentials. |
| `confirmPluginClear` | Approves selected default IDs/scopes, excluding credential payloads. |
| `selectPlugin` | Metadata-only chooser for `plugin inspect` without an operand. |
| `confirmOverwrite` | Optional nonempty-output confirmation. No bundled TTY prompt. |

Root-exported `OpSelectPlugin` takes frozen ID/name candidates and
`{ signal, accountId }`, returning an exact offered ID or `undefined` to cancel,
directly or via a promise. Built-in availability and account-scoped custom
candidates are separate from configuration. Explicit operands bypass selection;
singletons are never auto-selected. Resolved selection runs after the discovery
grant, pins the target/generation and does not repeat during execution. Direct
allow may select internally. Unconfigured inspection fails explicitly.

`OpConfirmOverwrite`, exported from root and Node, accepts frozen `{ path }`
and `{ signal }` and returns boolean or a promise. Only `true` grants replacement;
missing callback, false, error or cancellation refuses. Consent precedes
mode/truncate/write on an existing nonempty file. The opened handle is retained
across confirmation. Force skips this confirmation only, not policy. Callbacks
receive no output contents and must not consume template stdin for UI input.
File modes default to `0600`; accepted uint32 octal modes pass unchanged to
injected hosts, without a guarantee of native OS interpretation.

## Environment variables and inherited flags

Command flags and their environment defaults apply inside the virtual shell.
`OP_BACKEND_FILE`, `OP_BACKEND_MODULE`, `OP_COMPATIBILITY_CHANNEL` and
`OP_PLUGIN_SESSION_ID` are internal Node-host bootstrap settings, not plugin
backend selection. The plugin takes its backend/channel/scope through options;
setting these variables does not grant native host access.

SDK execution reads the supplied `env`; Node defaults to the process environment.
Explicit flags override associated environment defaults. Variables are not an
automatic credential-discovery mechanism.

| Variable | Behavior |
| --- | --- |
| `OP_BACKEND_FILE` | Explicit plaintext seed/snapshot path; mutually exclusive with module configuration. |
| `OP_BACKEND_MODULE` | Explicit trusted backend module path/URL. |
| `OP_COMPATIBILITY_CHANNEL` | `stable` default or `beta`; invalid values reject. |
| `OP_PLUGIN_SESSION_ID` | Plugin terminal identity unless overridden by `pluginScope.terminalSession`. |
| `OP_ACCOUNT` | Default account selector for `--account`. |
| `OP_SESSION` | Explicit backend session token default for `--session`; do not log it. |
| `OP_BIOMETRIC_UNLOCK_ENABLED` | Exact `true` selects app mode, `false` manual, absent uses trusted/manual mode. Other values reject before policy. |
| `OP_CACHE` | Parsed `--cache` default; no built-in native cache daemon. |
| `OP_CONFIG_DIR` | Parsed `--config` default. Ignored by built-in storage; forwarded to custom backends as interface metadata. No native config integration. |
| `OP_DEBUG` | Parsed `--debug` default; no complete native debug implementation. |
| `OP_FORMAT` | Default `human-readable` or `json` output format. |
| `OP_ISO_TIMESTAMPS` | Parsed timestamp flag default; unrecognized labels omit the derived flag. Native timestamp rendering remains incomplete. |
| `OP_INCLUDE_ARCHIVE` | Include-archive default on applicable commands. |
| `OP_RUN_NO_MASKING` | Run's no-masking default; explicit flags take precedence. |

Inherited flags are `--account`, `--cache`, `--config`, `--debug`, `--encoding`,
`--format`, `--help`, `--iso-timestamps`, `--no-color`, `--session`. Root version
flags report the package version. Encoding defaults to UTF-8; alternate labels
include case-insensitive gbk/shift-jis/sjis. Dotenv and document binary paths
have separate encoding behavior; Node cannot recover undecoded OS argv bytes.
`XDG_CONFIG_HOME`, historical `OP_SESSION_<shorthand>`, `OP_CONNECT_HOST`,
`OP_CONNECT_TOKEN` and `OP_SERVICE_ACCOUNT_TOKEN` do not supply complete native
authentication routing here. Native configuration discovery is intentionally
excluded: only an explicitly supplied backend file/module is loaded. With no
backend configured, Node fails instead of searching the home directory;
`homedir()` supplies plugin scope metadata only. No `POE_NO_PROMPT` consent is inferred.
Arbitrary supplied environment variables may be template/run inputs, not package
configuration; hosts should pass only intended values to children.

## Environment snapshots and helper APIs

`environment snapshot create/get/list/delete/restore` is a local extension, not
the upstream beta Environment service. `create --vars=A,B` captures selected
names, including explicitly unset names. Without `--vars`, it captures the
supplied environment completely. Metadata-only create/list does not display
values; get and restore/shell output can disclose them.

`captureEnvironment(environment, { names? })` returns frozen
`{ version: 1, scope: "complete" | "selected", variables }`; `null` means unset.
`restoreEnvironment(snapshot, current)` returns a new environment. Selected
restore preserves unrelated names; complete restore removes extras from the
known current environment. Neither helper mutates process or parent-shell state.

Restore may call `EnvironmentCommandContext.restoreEnvironment(snapshot,
{ signal })`, invoke a child, or emit shell source for bash/zsh/sh/fish/powershell.
Children are masked unless explicitly disabled and authorized. Shell emission
is not an atomic parent-shell transaction; readonly variables/eval-time changes
can cause partial application. Snapshots do not capture cwd, aliases, functions,
shell options or the entire shell state. Captured values are plaintext.

Other root APIs include `parseSecretReference`, `renderOpOutput`,
`parseOpFileMode`, `createOpTextCodec`, `selectOpGlobalFlags`,
`selectOpBackendContext` and the item/document/secret/environment handler factories.
`createDocumentHandlers(backend, { maxBytes? })` defaults to 16 MiB. Common stdin
and prepared source acquisition are also bounded; no unlimited-input guarantee
is made. Internal handler-preparation helpers are not public package exports.

## Verification and remaining scope

From the repository root:

```sh
npm run test:unit --workspace=@poe-platform/op
npm run lint --workspace=@poe-platform/op
npm run build:workspaces -- --workspace=@poe-platform/op
npm run lint:packages -- --json
```

Peirce reports the production freeze with 850 op tests, seven crypto tests and
10 plugin tests, plus lint/types/build/whitespace checks. Actual Node 18.18
source-loader checks without global crypto pass construction, IDs, passwords
and OTP. Planck reports seven browser checks and all 17 package-policy rules
passing after the conditional-crypto/bundling correction. Final integrated
verification is recorded in `out/op-root-final/VERIFICATION.md`: fresh maintained
build, prebuilt smoke, NodeNext/Bundler declarations, types/lint, workflow lint,
package policy and isolated installed Node 18.18 checks pass. The root unit task
has 11,528 passing tests and one skipped; this does not mean every workspace
unit task was rerun. The installed plugin needs no separate op package or global
crypto. The README example also passes unchanged against the retained archive.
Artifact SHA-256:
`212749e9cd1ab218d7f571eba51fd264c4e95511deeb7810ab999600c18dd205`.
This verifies local integration, not full native parity, a commit, push or release.
The earlier 835-test checkpoint includes fresh installed SDK/CLI checks;
those artifact checks do not cover the newer source freeze. The finite flag
inventory classifies syntax, not full semantic parity.
Template schemas beyond Login, timestamp/long-list/share-link rendering,
external provisioning and actual expiry/
device-deauthorization lifecycle remain incomplete. Valid duration strings are
forwarded to hooks; parser acceptance does not schedule expiration.

Further verification uses scenario recordings with explicit official/package
executable identity and synthetic data. Existing oracle evidence is retained;
users are not required to submit fixture bundles. Do not record real secrets,
tokens or private account data. Authentication/service and UI limitations must
be reported rather than portrayed as successful native scenarios.

The native recording index is `out/op-native-expanded-JvU0oR/INDEX.md` in the
repository: 89 attempts, each linked to text/cast/PNG, including five preserved
assertion failures. Subsequent authorized synthetic recordings supersede the
earlier no-auth schema/timestamp evidence gap; they do not establish local
implementation parity. Casts are buffered stream recordings, not live TTY proof.
The index records bounded cleanup and links the supplementary controls directory.

Repository references: [public contracts](../../docs/op.md),
[compatibility inventory](../../docs/plans/op-compatibility.md),
[current audit](../../docs/plans/op-completion-audit.md) and
[recording checklist](../../docs/plans/op-native-fixtures.md).
These repository documents may not be included in the npm archive. This README
does not claim a published package, successful release or universal native parity.
