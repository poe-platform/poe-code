# op virtual-shell command

## Current delivery contract: explicit command plugin

User direction supersedes standalone delivery: use `opCommands({ backend, ... })`
from `poe-code/safe-bash/commands/op` with `shell.use(...)`, like other optional
tools. The same subpath exports `createObjectBackend` and `createOpCommand`
(the composed shell `CommandDefinition`). There is no automatic registration,
native fallback, credential discovery or native config integration.
`packages/op` is now a private internal workspace, not a separate public npm
install/release target. Earlier standalone install, bin, publication and
no-safe-bash-integration statements are historical and superseded.

The adapter uses capability-checked virtual files and nested shell invocation;
policy and resolved object-binding requirements are preserved. Peirce reports
10 shell tests plus scoped types/lint/whitespace passing; Newton verified the
minimal public import/example. Peirce reports production frozen: 850 op tests,
seven crypto tests, 10 plugin tests and lint/types/build/whitespace checks pass.
The document handler now leaves omitted vault selection to the backend contract.
Core `#op-crypto` selects Node `node:crypto` Web Crypto or browser/workerd global
Web Crypto, failing closed when required browser primitives are absent. Actual
Node 18.18 source-loader checks without global crypto pass construction, IDs,
password generation and OTP. Planck reports seven browser checks and all 17
package-policy rules passing, superseding the earlier unresolved internal
import/global-crypto failures. Final integrated evidence is now inspected in
`out/op-root-final/VERIFICATION.md`: fresh maintained build, prebuilt smoke,
NodeNext/Bundler declarations, types/lint, workflow lint, all 17 policy rules
and isolated installed Node 18.18 proof pass. That consumer has no separately
resolvable op package or global crypto; IDs, password generation, independent
OTP, pipelines, denial and resolved approval pass. Root units finish with
11,528 passing tests and one skipped, not a rerun of all workspace unit tasks.
The README example was independently executed unchanged in the installed
consumer, returning `alice\n` with exit zero. Archive SHA-256 was independently
checked: `212749e9cd1ab218d7f571eba51fd264c4e95511deeb7810ab999600c18dd205`.
The public screenshot remains checkout evidence; installed proof is separate.
Local integration is verified; full native parity, commit, push and release
are not claimed. Older provisional packaging notes below are superseded.

## Current scope clarification: object seeds and recordings

The user authorized the package README; `packages/op/README.md` now exists.
Before the plugin packaging transition, `npm run lint:packages -- --json` passed: 72 packages, 17 rules,
zero violations and no skips. All five owned documentation files pass whitespace
checks. This is not fresh artifact, native-parity or release verification.
Earlier missing-README/permission and native-config-mapping gates below are
historical and superseded, not current requirements. No native 1Password config
integration is wanted: use `createObjectBackend(seed)` or Node's explicit
`OP_BACKEND_FILE` / trusted `OP_BACKEND_MODULE`. Built-in storage ignores
`--config`/`OP_CONFIG_DIR`; custom backends receive parsed interface metadata.
No backend means failure, not home/config discovery. Home-directory lookup is
plugin scope metadata only. No additional adapter API or native storage mapping
is required.

Current source exposes `OpObjectBackendOptions.defaultVault?: string`, an
existing vault ID stored canonically. Vault objects use `{ id, name }`; item
references use `vault: { id }`. Item creation precedence is explicit `--vault`,
then input `vault`, then configured default ID, then the sole vault in the
selected scope. Without a selector/default, zero or multiple eligible vaults
fail; an unavailable configured default also fails without fallback.
Snapshots retain the canonical default ID and its removal is rejected. No
Private vault is guessed. Peirce reports the source freeze with 842 passing
tests; this is not a fresh installed-artifact or native-parity checkpoint.

The user requested scenario recordings, not fixture submissions. Inspected
`out/op-native-recordings-uNuPJ6/summary.txt`: 13 scenarios use the verified
extracted official 2.39.0 oracle, explicitly labeled because no installed op
was found. Version/help/plugins/literal run succeed; template/item outputs and
piped literal inject stop at no accounts configured. No timestamp/schema output,
credentials or authenticated native behavior was obtained. The recording owner
reports inspected screenshots; casts are timed streams, not interactive TTY QA.
See [the recording workflow](plans/op-native-fixtures.md).

The user subsequently authorized Ptolemy to verify authentication and synthetic
recordings in one explicitly designated agent vault. That bounded work is
pending evidence here; it does not retroactively change the 13 no-auth results
or authorize unrelated vault access. Real vault identifiers are not reproduced
in package examples. Generic backend storage still has no native config integration.

Native template/rendering evidence remains unavailable, not a user-fixture
submission gate. Lifecycle/provisioning, remaining output fidelity, unsupported
file-backed resolved approval and verified delivery/release remain separate.
Existing checkpoints/artifact hashes below retain their original dates and
scope; they do not prove the new README or default-vault changes were packaged.


`packages/op` implements the private op engine behind the explicitly registered
safe-bash command plugin, with pluggable backends. The compatibility target is
1Password CLI 2.39.0; the implementation is independent of 1Password.

The command catalog, object backend, secret handling, and host capabilities are
under active compatibility verification. Recognizing a command is not evidence
that every upstream service behavior is implemented. See
[the compatibility inventory](plans/op-compatibility.md) for the complete target
and unresolved requirements.

## Explicit virtual-shell plugin

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

The public plugin import provides `opCommands`, `createObjectBackend` and
`createOpCommand` (a composed `CommandDefinition`).
`OpCommandsOptions extends OpCommandOptions`; it adds `replace?` (false),
`authentication?`, `pluginScope?`, `confirmPluginClear?` and `selectPlugin?`.
Registration is explicit; duplicate command registration fails without
`replace: true`. The allow callback above is only for synthetic demonstration.

File operations use cwd-relative VFS paths and capability checks, not native
filesystem discovery. Reads are bounded to 16 MiB; writes need permissions and
exclusive-create support, default mode 0600, and overwrite needs stat/chmod
with a regular-file target. Nested invocation stays in the virtual shell with
its stdin, cancellation and replacement environment; no host process/native op
fallback is introduced. The adapter does not supply parent-environment
`restoreEnvironment` or automatic Node crypto.

No 1Password config is needed. Seed objects and vault references are documented
in [the internal workspace guide](../packages/op/README.md). The following
low-level SDK/Node contracts are internal implementation references, not
instructions to install a standalone package or command.

## SDK and custom backends

```ts
import { createOp, createObjectBackend } from "@poe-platform/op";

const backend = createObjectBackend({
  vaults: [{ id: "development", name: "Development" }],
  items: [{
    id: "service", title: "Service", vault: "development",
    fields: [{ id: "password", type: "CONCEALED", value: "example-only" }],
  }],
});

const command = createOp({
  backend,
  authorize: request => request.resource === "read" ? "ask" : "allow",
  authorizeResolution: async request => approvalUi.confirmResolution(request),
  approveResolved: async approval => approvalUi.confirm(approval),
});

const result = await command.execute({
  args: ["read", "op://Development/Service/password"],
  env: {},
  signal: new AbortController().signal,
  stdin: emptyInput,
  stdout: outputSink,
  stderr: errorSink,
});
```

The example's `approvalUi`, `emptyInput`, and byte sinks are supplied by the
embedding host. Sinks expose asynchronous `write(Uint8Array)`; stdin is an async
iterable of byte chunks. `execute` returns `{ exitCode }`.

A custom backend supplies one method:

```ts
interface OpBackend {
  execute(request: OpBackendRequest, context: { signal: AbortSignal }): Promise<unknown>;
}
```

Requests contain `resource`, `action`, literal `args`, parsed `flags`, and optional
`input`. Nested resources use spaces, for example `vault user` with action
`grant`. Secret handlers resolve references with resource `secret`, action
`read`. The backend chooses how to store and retrieve data; there are no
provider-name branches in the dispatcher.

Object-backend options are `vaults`, `items`, `documents`, `accounts`, `resources`
for additional named collections, `adminHooks` for host-dependent operations,
`authentication`, `clock`, and `ssh` with `generate` and `transform` callbacks. The Node adapter supplies
SSH generation and key-format conversion; portable hosts can inject their own.
The Node subpath also exports `generateSshKey` and `transformSshKey`.
`resources["item template"]` supplies additional category schemas. The verified
built-in schema is Login; other upstream category schemas are not invented when
unavailable. This remains a gap against the full upstream template catalog.
`snapshot()` returns detached store state. Hooks receive a detached request and
resource map, and return `{ value?, resources? }`. They must implement actual
external effects where required; a generated local record does not authenticate
against a real service. Network service provisioning, authentication, and plugin
execution require explicitly supplied capabilities.

When seeding multiple accounts, associate account-owned records with
`account: "account-id"` or `account: { id: "account-id" }`. Items and documents
can inherit ownership through their vault. Account selectors accept IDs,
shorthands, addresses, and stored user identifiers. With multiple accounts and
no selected session, an account-scoped operation requires an explicit selector.
Unknown ownership is not treated as permission to expose all accounts.
Scoped operations preserve other-account state; concurrent conflicting changes
fail rather than silently overwriting newer state. Hooks receive the scoped
resource view, and their returned changes must remain within that account.

Hooks are keyed by canonical command path and are dispatched before built-in
resource handling. `item share`, `update`, and `plugin credential import` require
such hooks as well: the object backend cannot publish a working share URL,
download an update, or inspect external credential stores by itself. Host
authorization runs before these hooks. Cancellation prevents returned resources
from being committed and results from being printed; hooks remain responsible
for cancelling any external effects they start.

`createOp` options are `backend` (required), `authorize`, `approve`,
`approvalMode` (`resolved` by default, or explicit `literal`),
`authorizeResolution`, `approveResolved`, `handlers`, `version`, and `channel`
(`stable` by default, or `beta`). `handlers` can replace
command handlers by canonical command path. These are trusted host extensions.
`createDocumentHandlers` additionally accepts `maxBytes` (default 16 MiB).

## Managed authentication

The default `authentication: { mode: "object-store" }` is a credential-free
local store, not an authentication service. Choose `{ mode: "managed" }`
explicitly to enforce session admission. Supplying an invalid explicit session
never falls back to anonymous access, including in object-store mode.
Session admission does not replace host authorization or implement a complete
vendor role-based access-control system; configure `authorize` for the allowed
operations and disclosure boundaries.

Managed state uses `resources.session`, with `id`, `account`, `issuedAt`, and
`lastActivityAt` on every session. Timestamps are milliseconds since the Unix
epoch. Manual sessions have `mode: "manual"` and `token`; app authorizations
have `mode: "app"` and `terminalId`. Optional `revokedAt` records revocation;
`user` or `identity` supplies local identity data. Legacy session records without
validated lifecycle metadata require explicit migration rather than gaining a
new lifetime on restart. The injected `clock: { now() }` capability is not
serialized by `snapshot()`.

Manual sessions have a thirty-minute idle limit. App authorizations have a
ten-minute idle limit and twelve-hour hard limit, and are bound to a trusted
host terminal identity. Manual reuse requires the supplied bearer token;
account-selection metadata does not grant access or reveal a stored token.
Revocation, removal, or replacement of an admitted session prevents a pending
operation from committing local changes or returning its result. Activity-only
concurrent refreshes are merged. Hooks still own cancellation of external
effects; local rejection cannot undo an already completed remote action.
Sessions associated through `user` cannot access a suspended user account.
Suspension invalidates that user's sessions, including pending local operations;
reactivation does not restore the old credentials. Arbitrary `identity` payloads
are not interpreted as user associations.
The command context and Node host accept an `OpAuthenticationContext` through
`authentication: { terminalId?, integration? }`. `integration` is the trusted
host's `"manual"` or `"app"` mode; neither stored sessions nor plugin session
metadata infer the mode or authentication terminal identity. The common CLI/SDK
execution path resolves `OP_BIOMETRIC_UNLOCK_ENABLED` before host policy:
`true` selects app mode, `false` selects manual mode, and omission retains the
trusted mode or defaults to manual. The resolved context is frozen and forwarded
to policy and nested backend requests. Direct backend callers supply their
context themselves; they do not receive CLI environment parsing.

Only the exact strings `true` and `false` are accepted for this override. Invalid
values fail before policy or execution. This strict parsing is a conservative
package policy, not a verified claim about native case variants, aliases, empty
values, or help/version handling. The upstream
[environment reference](https://www.1password.dev/cli/environment-variables)
documents the two boolean values; the
[app setup guide](https://www.1password.dev/cli/app-integration)
describes the desktop integration setting and temporary environment override.
This package does not discover or modify that desktop setting.

Authentication hooks return typed `authentication: { sessions?,
terminalAccounts?, signedInSession? }` updates alongside their normal result.
`signedInSession` identifies the authenticated session by ID when a sign-in hook
returns multiple sessions. Generic hook
`resources` updates cannot replace session collections. Terminal-account
selection is persisted in `resources["session default"]`, separately from the
bearer or app authorization. Real sign-in, desktop unlock/revocation signals,
and remote service credentials must come from trusted host capabilities.
Service-account and Connect bearers are not modeled as manual sessions.

### Account selection and evidence boundary

For app integration, upstream documents `--account`, then `OP_ACCOUNT`, then
the account most recently selected through `op signin` in any terminal window.
Manual selection has the same explicit-selector precedence but uses the current
terminal's sign-in preference. See the
[signin reference](https://www.1password.dev/cli/reference/commands/signin),
[manual guide](https://www.1password.dev/cli/sign-in-manually), and pinned 2.39.0
help evidence in the [compatibility inventory](plans/op-compatibility.md).
These selection rules do not confer authorization in another terminal.

The approved managed-backend model stores at most one app-wide preference in
`resources["app default"]`, an `OpAppAccountSelection` record with `id` and
`account`. It is global within that backend state, not a machine-wide vendor
configuration file. Manual preferences remain `OpTerminalAccount` records with
`id`, `account`, and `terminalId` in `resources["session default"]`.

The app model records successful `signin`, including valid-session reuse, rather
than ordinary account access. Expiry and signout retain the app preference;
forgetting its account removes the dangling preference. Without an app
preference, selection requires an explicit account even when only one account
exists, instead of guessing from session order or account count. This
conservative provisional rule does not change manual mode's existing
single-account behavior; native initial-selection behavior remains unknown.
Preference updates never create or transfer authorization, and reuse does not
reset the app authorization's issuance time or hard lifetime.

These transition rules are approved package choices, not fully verified native
behavior. The native reference says `signin` avoids prompting when already
authenticated, but does not specify whether reuse updates recency. Preference
retention after expiry/signout, cleanup after forgetting, and missing-preference
behavior also remain native evidence gaps. The account-selection callback wiring
is verified by fresh SDK and Node sign-in persistence/reuse checks. The latest
frozen-code checkpoint passes 835/835 tests with zero skips, package lint/test
typecheck, the maintained build and whitespace. Workflow lint passed at the prior
checkpoint and was not rerun in the finite typed-flag refresh. Earlier package whitespace failed for
an extra EOF blank line in `plugin-list-output.test.ts:37`; Planck corrected it in
the test only. Whitespace now passes with production artifact unchanged.
Fresh installed SDK,
Node CLI, types and original approval-race checks pass as detailed below.
Package policy fails only for the missing README. Results are not delivery,
publication, or native parity.
See the [current requirement audit](plans/op-completion-audit.md) for hard gates.
The current packed-artifact evidence includes the bounded approval-binding
implementation; earlier 594-test artifact evidence is superseded for that gate.

This is the standalone backend's authentication contract, not a claim of native
credential storage or complete interactive sign-in parity. Security review and
the full compatibility inventory remain release gates.

## Vault options and permissions

Vault creation/editing validates the documented icon keywords and accepts only
`on` or `off` for Travel Mode. Invalid values leave the store unchanged.

Vault grants and revocations enforce the documented permission dependencies.
Missing prerequisites or remaining dependent permissions cause an error;
`--no-input` never silently grants additional access. Umbrella permissions are
expanded into granular permissions, and `move_items` is derived from the
required underlying permissions. This normalized local representation is not
an authenticated native result-schema claim. Account-tier restrictions and
native interactive permission prompts remain unverified.

Permission-value parsing now rejects invalid, empty or quoted entries and
trailing commas before account resolution, while accepting supported aliases
and case/whitespace variants. Ptolemy's frozen parser work reports 125 scoped
tests, lint/types/whitespace and 163 native comparisons with zero mismatches;
see `out/op-permission-command-oracle.log` and
`out/op-permission-parser-native-parity.log`. The parser screenshot was inspected.
The last full post-756 run had 769 passes and two plugin-selection failures;
Newton's subsequent red/green corrections and 27 independent scoped checks pass.
The latest unit checkpoint now passes 778 tests; the initial whitespace and README
policy failures remain separate: whitespace is corrected, README remains missing.
This is syntax evidence, not
native RBAC proof.

The parser for `group user grant --role` accepts `member` or `manager` case-insensitively but
does not trim whitespace. Empty, padded, quoted, CSV and unknown values fail
before authorization, input or backend calls; completion uses the same validation.
The declarative fix passes 59 scoped tests after two red cases, with reported
types/lint/whitespace and an inspected role-parser screenshot
(`out/op-role-parser-*.log`). The earlier installed uppercase-role failure is
corrected: backend normalization lowercases without trimming and stores/returns
canonical `member`/`manager`, while policy sees unchanged original flags and
caller arguments remain unchanged. Peirce's red/green backend checks pass 85
scoped tests. Newton's final 782-test checkpoint, lint/types, selected build,
whitespace and fresh installed SDK/Node/CLI smokes pass: MEMBER/MANAGER succeed,
invalid values fail before input/backend, and the normalized-output screenshot
was inspected. Workflow/package-policy checks were not rerun in this refresh;
their prior evidence and missing-README failure remain separate.
Current artifact: `out/op-role-fixed-checkpoint/poe-platform-op-0.0.1.tgz`, SHA-256
`b11a95a65a6123ad3cb55089ec16b065772a83c4e12f4e30ba69fb7c11d4e700`.
See `out/op-role-fixed-checkpoint-summary.log`; 90 package fingerprints are unchanged.
Expiry-duration syntax validation is now implemented for `--expires-in` on
`item share`, `events-api create`, `service-account create` and `connect token
create`, including the item's `--expiry` alias. Declarative `valueSyntax:
"duration"` routes the shared parser/completion checks to `isOpDuration`.
Malformed or overflowing values fail before authorization/input/backend;
valid raw strings and omitted flags remain unchanged through policy and binding.
Acceptance covers signed/component/fractional Go-style units and native-evidenced
day/week preprocessing, including probed rounding/overflow boundaries. This is
validation, not conversion of request values or a claim of universal equivalence.

Ptolemy's frozen work passes 796 unit tests, types/scoped lint/whitespace and
176 native comparisons with zero mismatches after nine red tests; screenshot
inspected. Evidence: `out/op-duration-parser-*.log` and
`out/op-duration-rounding-crosspath.log`. Newton's independent functional
verification and fresh checkpoint now pass; the 782-test artifact is prior.
The subsequent unsigned-accumulator wrap mismatch is corrected. Ptolemy's frozen
fix passes 799 unit tests, 17 targeted tests and 195 native comparisons with zero
mismatches (`out/op-duration-wrap-*.log`). Unsigned wrapping preserves the
per-component and intermediate overflow checks; both signs and nearby rejection
controls are covered. Newton's final 799-unit/17-focused checkpoint passes
lint/types, selected build, whitespace and fresh installed CLI/root/Node SDK/types.
All three installed surfaces accept both wrap signs, reject neighboring overflow
controls and preserve raw duration strings through policy/hooks. All 93 package
fingerprints are unchanged. Current archive:
`out/op-duration-fixed-checkpoint/poe-platform-op-0.0.1.tgz`, SHA-256
`f674d7f559e865c0fed29ba3337555b83131e144d17af47a0d35a0018f87d022`.
See `out/op-duration-fixed-checkpoint-summary.log`. Workflow/package-policy
checks were not repeated; their prior results are not current verification.
The missing-README policy gap remains open. This resolves the earlier regression,
not the limits of bounded native evidence or any expiry lifecycle requirement.

Expiry lifecycle remains separate: those four operations still require hooks;
accepting or forwarding `1h` does not schedule/enforce expiration. The new syntax
expiry validator remains distinct from the new Go-duration-only validation for
`user suspend --deauthorize-devices-after`. Plain local suspension works, but
supplying that flag requires an admin hook; delayed device
deauthorization lifecycle is absent. No scheduling, token issuance or revocation
parity is implied by parser success.

### Additional typed-flag validation

The post-799 parser batch now validates these values before authorization/input/
backend and aligns invalid completion with bounded native parse failures:

| Flag | Implemented syntax boundary |
| --- | --- |
| `user suspend --deauthorize-devices-after` | Go-style duration syntax; unlike `--expires-in`, no `d`/`w` extensions. No device scheduling is added. |
| `user edit --travel-mode` | Exact lowercase `on` or `off`; no case or whitespace normalization. |
| `vault create --allow-admins-to-manage` | `true`, `false`, `TRUE`, `FALSE`, `True`, `False`, `t`, `f`, `T`, `F`, `1`, `0`. Syntax acceptance alone does not establish native account policy. |
| `item create --ssh-generate-key` | Case-insensitive `ed25519`, `rsa`, `rsa2048`, `rsa3072`, `rsa4096`, `rsa-2048`, `rsa-3072`, `rsa-4096`; no trimming. Accepted case/hyphen variants reach canonical generators while policy retains raw flags. |
| `read --file-mode` | At least three octal digits, numeric value within uint32; default remains `0600`. Syntax does not guarantee that a host OS accepts every representable mode. |

Shared flag definitions also affect other commands using those definitions;
native evidence must not be generalized beyond the tested paths. Ptolemy's
initial frozen batch passed 828 tests after 21 red tests. Newton's final checkpoint
passes 829 tests, lint/types, selected build, whitespace and fresh installed
CLI/root/Node SDK/declarations; independent replay of 88 native grammar outcomes
has zero mismatches. SSH normalization is corrected, not waived; smoke tests use
synthetic generator fixtures. Uint32 modes, including 4294967295, reach injected
host capabilities unchanged; actual native OS interpretation remains unverified.
Raw deauthorization durations reach hooks, but missing hooks fail without state
change and no device lifecycle is implemented. Travel/admin results are local
metadata, not remote ACL enforcement. Screenshot inspected; 95 fingerprints
unchanged. Evidence: `out/op-static-five-checkpoint-summary.log` and its named logs.
Current archive `out/op-static-five-checkpoint/poe-platform-op-0.0.1.tgz`, SHA-256
`b8facd60f4b1fc331a80764b0dee779a760c61597361645dcba0b321822e2e33`.
Workflow/package-policy checks were not repeated; missing README remains an
unwaived gate. Native output/config/lifecycle and release gaps remain open.

## Batch selectors

### CSV and password recipe syntax

Standard CSV flag parsing now handles quoted fields, doubled quotes and record
boundaries; repeated CSV occurrences accumulate decoded values. Invalid earlier
occurrences are not hidden by later valid ones. Decoded arrays are frozen for
policy/resolved binding; caller argument mutation does not change the request.
Repeatable CSV flags remain available in completion. CSV syntax acceptance does
not validate category, feature, field, email or vault contents.

Password recipes accept case-insensitive `letters`, `digits`, `symbols` and one
length from 1–64 with an optional leading `+`; repeated classes are accepted,
duplicate lengths and malformed separators reject before policy/input/backend.
The backend now accepts native-valid `LETTERS,+20`, producing the requested
length/class while preserving raw recipe strings for policy/prepared requests.
Installed checks also cover `DIGITS,+8` and `letters,letters`; no generated
passwords were printed in verification logs.

The final checkpoint passes 835 tests, lint/types, selected build, whitespace
and fresh installed CLI/root/Node SDK/declarations, with 70 saved native outcomes
matching. Screenshot inspected; 97 package fingerprints unchanged. Evidence:
`out/op-typed-closure-summary.log`. Current artifact:
`out/op-typed-closure-checkpoint/poe-platform-op-0.0.1.tgz`, SHA-256
`3c7446b1c2e0741d2dfa3a248e9cae9776ef84d1ad25986ad95154b762e31e76`.
Workflow/package-policy routes were not repeated; missing README remains open.

The finite inventory covers 82 catalog commands and 174 flag occurrences:
89 syntax-covered, 29 free-form, 56 backend/auth-dependent. These are not counts
of fully compatible commands. Six Environment/bespoke snapshot command paths
lack captured native help. Full schemas, lifecycle, config, native output and
delivery requirements remain unresolved; this is not full native parity.

Supported object-backend batch paths include `vault get/edit/delete`,
`item get/delete/move`, `document delete`, and vault relationship lists. Pass `-` as the selector
and provide newline-separated names/IDs, JSON objects with IDs, or arrays of
those objects on stdin. Concatenated JSON objects are accepted as well.
The canonical batch request passes through host authorization once, before
backend execution. Built-in batch mutations validate all targets before changing
store state, including account and vault boundaries. Item create/edit template
stdin keeps its separate meaning. Vault batch editing reads only selectors from
stdin and applies changes supplied through flags. Exact authenticated native batch output
shapes remain an evidence gap.

`item get` also accepts piped selector objects without an explicit `-` operand.
`item create -` accepts a single JSON item template or an array; array creation
validates before committing the batch. Copying exported item JSON assigns new
item identity rather than replacing the source. For cross-account copies,
explicitly select the destination with both `--account` and `--vault`.
Destination admission and target validation remain required, and source state
is preserved. This local copy/remapping contract is not proof of native ID
remapping or exact single/array output serialization.

Item-get field output derives `reference` from current vault/item/section/field
IDs, including for valueless fields. Create, edit, and move discard supplied
field references instead of retaining stale paths. Raw ID segments are valid
reference syntax; optional sections are included where applicable. Unsupported
name characters require ID addressing, not invented percent-encoding. The
upstream choice of names versus IDs in returned references remains unverified.

## Parsing and help metadata

The common CLI/SDK path resolves profiled leaf-local flags before or after the
final verb and validates known operand constraints before authorization or
custom backend execution. `OpCatalogCommand.args` describes these constraints
as `{ min, max?, stdinAlternative? }`; unprofiled constraints remain unset rather
than being guessed. Conditional command rules supplement those bounds. Native
coverage is limited to the profiled cases, not every parser permutation.

Shared catalog metadata supplies node summaries/descriptions, usage synopses,
examples where provided, help grouping/order, flag descriptions/metavariables,
displayed defaults, and visibility. Help and completion use that metadata;
displaying a default does not implement its semantics. Native-exact help prose,
all errors/prompts and backend-derived completion suggestions remain outside
the verified coverage. Config-directory host behavior, debug/cache behavior,
and native timestamp formatting remain unsupported by the built-in backend;
accepting and forwarding those global flags does not implement them.

## Character encoding

Text input/output defaults to UTF-8. `--encoding` accepts `gbk`, `shift_jis`,
`shift-jis`, `shiftjis`, and `sjis`, case-insensitively. Native stable 2.39.0
rejects explicitly naming UTF-8, despite using it by default; omit the flag for
UTF-8. The help/version flags bypass encoding validation. Diagnostics stay
UTF-8, dotenv files stay UTF-8, and binary document bytes and child output are
not transcoded. The SDK uses the same conversion path as the CLI.

Native probes verified accepted labels, validation order, and argument decoding.
Successful authenticated transcoding and malformed-character behavior remain
unverified. Node's already-decoded process arguments cannot preserve arbitrary
non-UTF-8 operating-system argument bytes, so that native boundary remains a
compatibility limitation.

Completion uses a shared argument-aware resolver and the hidden `__complete`
and `__completeNoDesc` callbacks. Bash, Zsh, Fish, and PowerShell adapters use
these callbacks rather than independent command grammars. Command aliases,
flag aliases, and root version flags derive from the command catalog; completion
does not query secret backends. Bash and Zsh adapters have executed runtime
checks, and the Node zero-backend callback screenshot was inspected. Zsh checks
captured callbacks outside ZLE; interactive Tab-key QA was not performed.
Fish and PowerShell runtime checks remain unavailable.
Descriptions now come from shared catalog metadata. Dynamic account, vault,
item, or other backend-derived argument suggestions remain unsupported; exact
vendor wording and full native completion parity are not claimed.
Required-flag priority, prefix fallback and visible cache/config suggestions now
pass 55 scoped tests and 218 pinned native candidate/directive comparisons with
zero mismatches. Ptolemy inspected
`screenshots/op-completion-required-native-parity.png`; evidence is in
`out/op-completion-required-{red,scoped-final,types-final,lint-final,native-valid-parity,manual}.log`.
This is completion-only behavior, not new parser constraints or backend value
queries. Permission-value parsing has separate bounded verification described
above; alternative requirement groups remain unverified/incomplete. The earlier 756-test checkpoint and installed CLI
completion checks pass; they do not broaden those bounded native observations.

## Approval and disclosure

`authorize` returns `allow`, `deny`, or `ask`. Denial stops execution; direct
`allow` and an omitted authorizer retain the direct path without binding or an
implicit discovery callback. These direct paths are not resolved approval.
An explicit denial stops before stdin/file acquisition or backend preparation;
this is deny-before-input ordering, not a deny-by-default authorizer. For
resolved `ask`, missing required capabilities or a denied resolution grant also
stop before input acquisition. Trusted Node module loading remains host bootstrap,
not an effect sandbox supplied by this policy.
`--force`, `--reveal`, `--raw`, and `--no-masking` never override host policy.

For `ask`, default `approvalMode: "resolved"` requires both
`authorizeResolution(request, context)` and `approveResolved(approval, context)`
to return `true`, plus backend binding capabilities and a preparation-capable
handler where one is used. `authorizeResolution` gates input/source acquisition
and metadata preparation; it is not execution permission. Final approval occurs
after preparation. Missing, denied, rejected, or cancelled capabilities fail
closed, with no automatic downgrade to literal approval.

Explicit `approvalMode: "literal"` uses the legacy `approve(request, context)`
callback for `ask`. It binds literal selectors, not their eventual referents,
and does not satisfy the resolved-identity promise. Approval mode is trusted
embedding configuration; there is no new CLI flag or environment variable for
it. Initial `authorize`, `authorizeResolution`, and literal `approve` receive
literal request metadata before stdin acquisition, not a resolved or redacted
manifest. Arguments and flags may contain secrets: do not log these requests or
render them directly as safe UI text.

`approveResolved` receives a deeply frozen `OpResolvedApproval` containing
`operation: { resource, action }`, `backendId`, nullable `accountId`, `targets`,
`optionNames`, `mutation: { requested, propertyNames, assignmentNames, batchSize? }`,
`output: { kind, destination? }`, and optional
`child: { executable, argv, environmentNames }`. Output kind is `none`, `stdout`,
or `file`. Each child argument is `[redacted]`, preserving count/order; full argv
and values remain private. The projection excludes input/flag/environment values
and the binding handle. Names, IDs, executable and destination still constitute
metadata whose disclosure the host must authorize.

Binding-capable backends implement `prepareBinding(requests, context)`,
`validateBinding(handle, context)`, and `cancelBinding(handle)`. These are
optional on `OpBackend` but required for resolved `ask`; `OpObjectBackend`
implements all three. Preparation returns `OpPreparedBinding` with `backendId`,
nullable `accountId`, opaque `handle`, `targets`, and request-aligned `metadata`.
`OpBindingTarget` contains `requestIndex`, `resource`, `kind`
(`object`, `collection`, `field`, or `section`), `revision`, and optional `id`,
`account`, `parentId`. Request metadata can describe environment names,
`unsetNames`, `scope`, and `dependenciesComplete`. The prepare context optionally
accepts `expiresAt` in milliseconds on the injected clock. The object backend
defaults to a 60-second binding lifetime and accepts at most 1,024 planned
requests in one account scope. These are local safety limits, not native protocol
defaults; no CLI/env setting for them is exposed.

The coordinator privately propagates `OpBackendContext.binding`; handles must
not be supplied through argv, environment, JSON, or persisted state. It ignores
a caller-supplied command-context binding. Resolved custom handlers need a
`prepare` method that declares backend requests and effects; an ordinary handler
without preparation is unsupported for resolved `ask`. Backend/handler code
must reject unplanned or stale requests rather than perform late name lookup.
Coarse backend-generation invalidation can conservatively abort unrelated work;
this extra-abort behavior is provisional, not native conflict-policy parity.

The callable handler's `prepare(request, context)` returns a promise of
`{ requests, context, effects, complete(metadata) }`. `requests` fixes the nested
backend plan; the returned `context` supplies owned input bytes and guarded
effects. `complete` receives request-aligned backend metadata and returns the
final effect descriptions before resolved approval. Effect kinds are `stdout`,
`file`, `invoke`, and `restore`, with applicable `path`, `options`, `command`,
`argumentCount`, `environmentNames`, `unsetNames`, and `masking` metadata.
Missing dependency information or an effect outside the plan fails closed.

The built-in `createSecretHandlers`, `createItemHandlers`,
`createDocumentHandlers`, and `createEnvironmentHandlers` factories are root
exports; `createOp` composes them. Their preparation helpers
`createSourceSnapshot` and `createHandlerPreparation`, and the named preparation
types, currently live in internal `handler-preparation.ts`, not an exported
package subpath or root re-export. Do not import that internal path as a promised
public helper API. Structural custom handlers must provide the preparation
contract themselves; ordinary custom handlers remain direct/literal-only.

The object binder rejects hook-backed/external operations, plugin operations
other than supported object-backed `plugin inspect`, session resources,
unsupported multiword resources, and SSH generation/transformation
hooks. Incomplete secret-derived Environment dependencies also fail rather than
silently authorizing new references. Catalog acceptance and a working direct
path do not imply resolved capability support for every command.

Validation before execution, local commit and host handoff is implemented, but
actual file/process/restore/network effects remain the host's responsibility.
Validation receives the bound authentication context. A synchronous validator
hands off to the host effect without an intervening promise turn; an asynchronous
validator must provide the consistency guarantees appropriate to its backend.
Preparation and manifest-access failures use sanitized policy errors, including
synchronous exceptions and throwing metadata getters.
No OS inode pinning, executable-content identity, cross-process file revision
proof, or distributed atomicity is promised. `OP_BACKEND_FILE` therefore fails
closed for resolved `ask`; direct execution and explicit literal approval remain
available without acquiring the stronger guarantee. Use a binding-capable
`OP_BACKEND_MODULE` or in-memory object backend for the implemented resolved path.

The supported cooperative object-backend binding gate is verified: 756/756
maintained package tests pass with zero skips, along with lint/test typecheck,
build, whitespace and fresh installed consumer SDK/Node CLI/types checks.
The original rename-during-approval regression exits 1 with zero operation output
and no stale execution through the installed SDK, Node CLI and executable.
Unchanged and denied controls pass; approve/deny screenshots were independently
inspected. The preceding 33/33 independent boundary checks verify bound auth
context, synchronous validation/handoff ordering and closure of preparation and
metadata-getter error leaks. The Node validator directly returns the cached
backend's result without an added await or reload, verified in source and artifact.
See the [frozen verification evidence](plans/op-resolved-approval-verification.md#frozen-checkpoint-results)
and `out/op-resolved-final-node-validation-wiring.log` for exact scope and logs.
The later `out/op-final-checkpoint-summary.log` records passing workflow lint,
fresh installed CLI/root SDK/Node SDK/declaration checks, synthetic timestamp-env,
ordered batch/rollback and overwrite checks, with 78 source/config/license
fingerprints unchanged. Current archive SHA-256:
`7957abfd576803e84cceffb606d48edc73e1aa6fe4557609541f26634e9d39f6`.
Package policy still fails only for the missing README; this is local verification,
not publication or complete native parity.
The current combined artifact supersedes that earlier archive:
`out/op-combined-checkpoint/poe-platform-op-0.0.1.tgz`, SHA-256
`8b484dbe025238c890ab1a5a3dfb4ddf2284b2599995b4ffb25bd225dd6f8ec2`.
`out/op-combined-checkpoint-summary.log` records 756 passing tests, fresh
installed selector/approval checks and 82 unchanged package fingerprints.
Identity/environment security tests exercise resolved mode; explicit legacy
callback tests use literal mode, and ordinary functionality tests may use direct
allow. These distinct contracts must remain explicit in final evidence.
The independent Mendel review invocation that returned a terminal policy error
did not complete and remains separate from Ptolemy's active ordinary review.
The [proposal](plans/op-approval-bindings.md) preserves the invariant and bounded
host contract. This closes the supported object-binding gate, not arbitrary
adapter correctness or control after host invocation. File-backed resolved mode
remains unsupported; native fidelity, README permission and release gates remain
open. The unavailable broader review is not credited as completed.

Compatibility with `op read`, `op inject`, and `op run` includes plaintext output,
file injection, and child environment injection. Human item output conceals
sensitive fields by default; JSON and explicit reveal operations can expose them.
Run masking protects ordinary output, including chunk boundaries, but a child
program can transform or transmit credentials. Policy must deny plaintext uses
when an embedding requires secrets to remain inaccessible to agent code.

`read` accepts text, binary attachment bytes, and nonnegative integer attributes
such as attachment size. Binary bytes are written unchanged, including with
`--out-file`; text encoding applies only to text. `inject` and `run` still require
text secret values rather than silently decoding binary attachments. Native
binary stdout newline behavior and exact numeric formatting remain unverified.

The Node file host accepts missing or existing empty regular output files
without `--force`, refuses nonempty files without it, and applies the requested
file mode before writing. Empty-file acceptance is verified for native document
retrieval; its use by other handlers is a shared-host policy, not independently
verified native parity.

## Beta Environments

For beta `run --environment`, seed `resources.environment` with records shaped
like `{ id: "development", variables: { TOKEN: "value" } }`. String-record values
are literal: empty strings, quotes, newlines, and reference-looking text are
preserved. Custom backends may also return legacy dotenv text for
`environment read`. Invalid value types fail before a child is launched.
Environment values participate in normal output masking and host authorization.

## Environment snapshots

These are package extensions, separate from upstream's beta `environment read`:

```sh
op environment snapshot create development
op environment snapshot create selected --vars PATH,TOKEN,OPTIONAL
op environment snapshot list
op environment snapshot get development
op environment snapshot restore development -- your-command
op environment snapshot restore development --shell bash
op environment snapshot delete development
```

Capture and list return metadata rather than variable values. Get returns the
stored snapshot, including plaintext values. Capture stores the current
environment strings exactly; it does not resolve secret references.

A complete snapshot restores its exact variable set. A selected snapshot changes
only selected names and records missing names as unset. Empty strings remain
distinct from unset variables. Selected shell output includes only selected
names, including explicit unset instructions for selected missing variables;
it does not print or reassign unrelated values. Child restoration leaves the caller unchanged and
masks captured values in child output unless `--no-masking` is explicitly set.
Explicit shell output supports `sh`,
`bash`, `zsh`, `fish`, and `powershell`; it contains values intended to be evaluated
by that shell. Evaluate it only after inspection and approval. Shell execution
errors can cause a partial parent-shell update; emitting a script is not an
atomic host transaction.

Embedding hosts can provide `EnvironmentCommandContext.restoreEnvironment` to
apply a validated snapshot to their own runtime. The host owns atomic application
and must honor the supplied cancellation signal. Without that capability,
restoration requires an explicit child command or shell output; an executable
cannot directly change its parent shell.

The SDK also exports `captureEnvironment(environment, { names? })` and
`restoreEnvironment(snapshot, current)`. They return detached values and do not
mutate their inputs. Snapshot version 1 currently represents environment
variables, including complete/selected scope and unset values.

## Plugin scopes

### Availability versus configuration

Built-in plugin availability now comes from `plugin-catalog.ts`, separate from
the command parser catalog and account-scoped plugin configuration. With no
configured plugins, `plugin list --format=json` returns 90 captured native rows:
89 executable entries plus a `rediscloud` registry row without an executable.
Rows retain the captured `source`, `name`, `executable`, and `plugin_name`
properties where present. An independent structured comparison matches all rows
and ordering from `out/op-oracle/plugin-availability-toNiXs/probe-0.json`.
The frozen human renderer uses `EXECUTABLE`, `NAME` and `REQUIRED FIELDS`
columns rather than generic record fields; human and JSON output are reported
byte-identical to the native captures. Planck's
`/tmp/op-plugin-list-native-columns.png` screenshot was inspected without clipping.
`pluginRequiredFieldLabels`
contains native display strings, not full credential schemas; JSON is unchanged.

Account-scoped custom configured plugins absent from the built-in executable
set are appended as ID/name metadata, with case-insensitive duplicate suppression.
Availability does not manufacture credential configuration. Explicit inspection
or chooser selection of an available but unconfigured executable fails with
`Plugin configuration is unavailable`; native interactive inspection remains
unsupported rather than being simulated as successful configuration.

Newton reports 27 independent dedup/order/isolation/admission tests passing after
correcting stale chooser expectations. Updated Node tests pass 117/117 plus
lint/types with assertions retained/strengthened. Renderer, code and tests are
frozen; Newton's 778-test run and installed human/JSON native comparisons pass.
The current artifact includes this availability addition; the initial whitespace
failure is corrected but README policy remains open. No provisioners, credential-field schemas,
automatic TTY UI or `plugin init` implementation are implied.

### Host plugin selection

For object-backed `plugin inspect` without an operand, the host may supply
`selectPlugin` on `OpCommandContext` or `OpBackendContext`; Node embedding forwards
`NodeHostDependencies.selectPlugin`. The portable root exports this callback type:

```ts
type OpSelectPlugin = (
  candidates: readonly Readonly<{ id: string; name: string }>[],
  context: Readonly<{ signal: AbortSignal; accountId: string | null }>,
) => string | undefined | Promise<string | undefined>;
```

Candidates are an immutable array of frozen ID/name pairs combining public
built-in availability with account-scoped custom entries, not configuration or
credential records. Built-ins use executable IDs and plugin display names;
entries without an executable or ID are not offered. Missing names fall back to IDs.
Return an exact offered ID; a name, differently cased ID or foreign ID is not a
selection. `undefined` cancels. Missing callback, callback errors,
rejection or cancellation fail closed. Even one candidate requires an explicit
callback choice. An explicit plugin operand bypasses selection.

In resolved `ask`, metadata preparation invokes the chooser only after the
resolution grant, then pins the selected ID and generation for final approval.
Execution uses that prepared selection without prompting again; intervening
generation changes invalidate it. Direct `allow` can invoke the chooser inside
the object backend's internal preparation without an approval callback; this is
not resolved host approval. Literal approval keeps its weaker contract.
Hook-backed operations and file-backed resolved mode remain unsupported.

This is an injected SDK/Node host capability, not an automatic CLI TTY chooser.
No environment variable, new native flag, UI dependency or `plugin init`
implementation is added. The standalone executable has no implicit chooser.
The final 756-test checkpoint and fresh installed root/Node SDK checks verify
scoped immutable metadata, exact offered-ID selection, resolved approval order,
invalid/foreign/cancelled choices and central denial. Planck's synthetic
chosen/cancelled/explicit-operand screenshots were inspected. This supersedes
the earlier 718-test artifact for the chooser, not native prompt parity.

Object-backed plugins may store a `defaults` array. Each entry has an `id`, a
`configuration` object, and a `scope`: `{ kind: "global" }`,
`{ kind: "directory", path: "/absolute/path" }`, or
`{ kind: "terminal", terminalSession: "host-session-id" }`.
These are local object-backend shapes, not a native configuration-file format.

Hosts supply `pluginScope: { cwd, home, terminalSession? }` through the execution
context. Paths must be normalized and absolute, with forward slashes. Clearing
uses terminal, current/ancestor directory, then global precedence. `--all`
affects only applicable defaults for the selected plugin. Unscoped legacy
configuration requires explicit migration rather than being guessed global.

Without `--force`, a host `confirmPluginClear` callback must approve the selected
default IDs and scopes; credential payloads are excluded from that confirmation.
Force skips this confirmation only, never central host authorization. The Node
adapter accepts `pluginScope` and `confirmPluginClear` dependencies and uses its
working directory and OS home directory when paths are not supplied. Terminal
identity must be supplied explicitly; it is never inferred from `OP_SESSION`.

## Host I/O

Latest local artifact: `out/op-release-checkpoint/poe-platform-op-0.0.1.tgz`,
SHA-256 `f630326651829160b197851f1fe96ac1222e14e7790320406d63846511fab2a7`.
`out/op-release-checkpoint-summary.log` records installed CLI/root/Node SDK/types
checks, inspected plugin-list screenshot and 89 unchanged package fingerprints.
Its name does not imply a release; native and delivery gates remain open.

The portable context may supply `readFile`, `writeFile`, and `invoke`.
`writeFile(path, bytes, { mode?, overwrite? })` must enforce requested permissions
and overwrite policy. File-producing commands default to mode `0600` and require
`--force` to overwrite without a host prompt. `invoke` receives a literal command,
arguments, the replacement environment, and optional wrapped output sinks.
All external work must honor the context's cancellation signal.

The Node adapter is available as `@poe-platform/op/node`. `runOpCli` accepts
optional dependencies for filesystem methods, process spawning, module loading,
working directory, environment, stdin/stdout/stderr, cancellation, and version.
`NodeHostDependencies` also accepts `authorize`, `approve`, `approvalMode`,
`authorizeResolution`, and `approveResolved`, alongside `authentication`,
`pluginScope`, `confirmPluginClear`, and `selectPlugin`. The host must explicitly arrange trusted
module/bootstrap loading; dependency injection does not sandbox a module.
Dependency injection supports offline tests and controlled embedding. The
portable root export does not import Node process or filesystem modules.

`NodeHostDependencies.confirmOverwrite?: OpConfirmOverwrite` optionally confirms
replacement of a nonempty output file. The callback type is defined in
`host-contracts.ts` and exported from both `@poe-platform/op` and
`@poe-platform/op/node`:

```ts
type OpConfirmOverwrite = (
  intent: Readonly<{ path: string }>,
  context: Readonly<{ signal: AbortSignal }>,
) => boolean | Promise<boolean>;
```

The callback receives the resolved destination path, not output data. Only
explicit `true` permits replacement. Absent callback, false, rejection or
cancellation fails closed; the host must map EOF to refusal. Consent precedes
mode changes, truncation and writes on an existing nonempty file. The Node host
retains the opened file handle across confirmation rather than reopening a
possibly replaced path. Late consent after cancellation does not permit writing.
`--force` skips this confirmation only, never command authorization. Empty files
do not require this callback. No native flags, template-stdin consumption or
automatic TTY prompt are added; hosts own any UI and its input source.

Ptolemy reports 113 scoped tests plus lint/typecheck passing, including preservation
of bytes/mode on refusal and cancellation, path replacement and truncation before
shorter output. The root/Node public type exports are present, with compile
red/green verification reported. Frozen 756-test maintained checks and fresh
installed CLI/root/Node SDK checks pass. Manual host and standalone CLI checks pass: shorter approved
output is saved with mode `0600`; deny/throw/reject/missing callback exit 1 and
preserve old bytes and mode `0640`. Force skips confirmation but not policy;
standalone CLI without a callback refuses a nonempty file. No file contents
appear in stdout, diagnostics or callback intent. Allow/deny screenshots were
independently inspected; evidence is in `out/op-overwrite-manual-host.log` and
`out/op-overwrite-manual-cli.log`. These results do not prove native prompt
text/defaults, authenticated native success or atomic host effects generally.

## Environment configuration

| Variable | Meaning |
| --- | --- |
| `OP_BACKEND_MODULE` | Explicit module exporting the backend and optional policy callbacks. Mutually exclusive with `OP_BACKEND_FILE`. |
| `OP_BACKEND_FILE` | Explicit persistent object-store JSON file. Resolved `ask` is unsupported without persistent revision guarantees; direct/literal paths remain available. |
| `OP_COMPATIBILITY_CHANNEL` | Node adapter compatibility channel: `stable` or `beta`. |
| `OP_PLUGIN_SESSION_ID` | Explicit terminal identity for plugin defaults; a Node dependency override takes precedence. |
| `OP_ACCOUNT` | Default account selector; explicit CLI flag takes precedence. |
| `OP_BIOMETRIC_UNLOCK_ENABLED` | Common CLI/SDK override: exact `true` selects app integration, exact `false` selects manual. Omitted uses trusted `authentication.integration`, otherwise manual. Invalid values fail before policy. |
| `OP_CACHE` | Default parsed cache flag; backend determines caching behavior. |
| `OP_CONFIG_DIR` | Parsed interface flag, ignored by built-in storage and forwarded to custom backends; no native configuration integration. |
| `OP_DEBUG` | Default parsed debug flag. |
| `OP_FORMAT` | Default `human-readable` or `json` output. |
| `OP_ISO_TIMESTAMPS` | Default parsed timestamp-format flag; unrecognized labels omit the derived flag. This chosen fallback does not establish native effective formatting. Explicit flags remain strict and take precedence; timestamp rendering remains unimplemented. |
| `OP_SESSION` | Default session credential passed to the configured backend. |
| `OP_INCLUDE_ARCHIVE` | Include archived objects where the command supports it. |
| `OP_RUN_NO_MASKING` | Default run output-masking override. |

The Node adapter supplies its process environment to child execution unless
replaced by a restoration operation. The portable SDK only sees the environment
explicitly supplied by its host. Cache, configuration, sessions, and debug flags
are not promises of vendor daemon, authentication, or filesystem behavior.

## Verification and release

```sh
npm run test:unit --workspace=@poe-platform/op
npm run lint --workspace=@poe-platform/op
npm run build:workspaces -- --workspace=@poe-platform/op
npm run lint:workflows
```

Delivery now follows the containing poe-code package and its explicit plugin
export. There is no separate public op-package installation or release.
Integrated packaging, remote-main delivery and release verification remain
distinct from internal workspace checks and historical standalone artifacts.
