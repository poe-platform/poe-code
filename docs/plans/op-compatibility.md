# op compatibility inventory

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
See [the recording workflow](op-native-fixtures.md).

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


For the authoritative current-tree status and remaining assignments, use the
[current requirement audit](op-completion-audit.md). The source inventory and
historical checkpoints below retain their original evidence boundaries; old
findings are not automatically current failures or completed requirements.

## Authority, scope, and evidence

Investigated 2026-09-07. Target: standalone `packages/op`, with pluggable backends, initially supplied JavaScript objects, and host-controlled approvals. No safe-bash integration. The required outcome is full 1:1 CLI interface compatibility, including administration, authentication, plugins, completion, updates, and beta surfaces; secret retrieval alone does not satisfy the requirement. SDK and CLI must expose the same operations. Release is requested, but this document is an investigation deliverable, not evidence of implementation, publication, or release.

The stable version reference is **1Password CLI 2.39.0, released August 14, 2026**, confirmed by the [official stable releases](https://releases.1password.com/developers/cli/) and [download release history, build 2390001](https://app-updates.agilebits.com/product_history/CLI2#v2390001). The latter also lists **2.39.1-beta.01, August 13, 2026**, build 2390101. Stable and beta must have separate compatibility manifests: the live reference mixes both. The current [command reference](https://www.1password.dev/cli/reference) is the redirect destination of the former developer.1password.com reference.

Initial evidence gathered: the reference index, all 19 linked command-family pages (76 executable leaf forms), official release histories, the documentation sitemap, and linked syntax/configuration guides. Public Markdown representations were fetched in memory. `command -v op` found no executable; `/opt/homebrew/bin/op`, `/usr/local/bin/op`, and `/usr/bin/op` were also absent. This is not an exhaustive disk search. The subsequently authorized native-oracle pass is recorded below and supersedes unresolved claims where stated. No binary was installed, no account-data commands were executed, and no credential stores, session values, Keychain data, or private 1Password files were read.

Applicable instructions read: `/Users/kjopek/Workspace/AGENTS.md` and repository `AGENTS.md`; no `docs/AGENTS.md` or `docs/plans/AGENTS.md` was found. The ancestor requests delegation; this session exposed no subagent tool. Only this inventory is owned and written. The original proposed filename `safe-bash-op-compatibility.md` is superseded by this file.

**Evidence labels:** D = documented in the current command reference; R = additional official release-note evidence; U = unresolved against a pinned executable. D does not imply binary-tested or implemented. Every row below is required coverage, not a passing test. Absence of a flag section means “no local flags documented,” not proof that no other flags exist. Byte-exact output schemas, hidden aliases, prompts, and errors remain U unless explicitly described.

## Global interface

Every command inherits this documented surface. Bare parent commands and `--help` at every tree node need compatibility too. Source: [reference/global flags](https://www.1password.dev/cli/reference#global-flags).

| Flag | Type/default and meaning |
| --- | --- |
| `--account` | String selector: shorthand, sign-in address, account ID, or user ID; `OP_ACCOUNT`. |
| `--cache` | Boolean, default true on UNIX-like systems; unsupported caching on Windows; `OP_CACHE`. |
| `--config` | Configuration directory; overrides `OP_CONFIG_DIR`. |
| `--debug` | Boolean; `OP_DEBUG`. |
| `--encoding` | Default UTF-8; documented alternatives GBK and Shift-JIS. Exact accepted spelling/case U: flag text says `SHIFT_JIS`, narrative says `shift-jis`. |
| `--format` | `human-readable` (default) or `json`; `OP_FORMAT`. Not a blanket JSON wrapper around byte streams, scripts, or subprocess output. |
| `-h`, `--help` | Help for the addressed command. |
| `--iso-timestamps` | ISO 8601/RFC 3339 timestamp rendering; `OP_ISO_TIMESTAMPS`. |
| `--no-color` | Disable color. |
| `--session` | Session-token authentication. Treat the argument as secret material. |

`op help [command...]` is referenced by the docs. Capture `op --version`, possible short version aliases, root usage, help topics, completion internals, and flag inheritance from the pinned binary before declaring root parity. Do not fabricate a `version` subcommand or global `--yes`/`--force`: neither appears in the global reference. The repository's own interactive defaults must not silently alter op-compatible parsing or documented op defaults.

Parser requirements include flag placement before/after nouns, `--flag=value` versus separate values, explicit boolean false, optional flag values, short aliases, repeated versus comma-separated arguments, `--` termination, empty values, quoting after shell tokenization, unknown/missing arguments, mutual exclusions, stdin selection, and suggestions. Exact acceptance/error behavior is U. Preserve the distinction between a string array (repeated flags) and a comma-separated list.

## Complete indexed command tree and local flags

All rows imply the `op` prefix and inherited global flags. Square brackets denote optional input; `...` denotes repeated input. “Specifier” means the explicitly stated selector types, not arbitrary object coercion. `-` denotes documented stdin support; do not infer it for other commands. “None listed” concerns local flags only. Parent nodes are preserved by the path columns and headings.

### Accounts

Source: [account](https://www.1password.dev/cli/reference/management-commands/account). D: four leaves.

| Path and operands | Local flags | Observable contract |
| --- | --- | --- |
| `account add` | `--address string`, `--email string`, `--raw`, `--shorthand string`, `--signin` | Configure account; optional sign-in; raw session-token output. |
| `account forget [account]` | `--all` | Remove local account configuration; all-account variant. |
| `account get` | None listed | Account details. |
| `account list` | None listed | Configured accounts/users, not vault inventory. |

### Completion

Source: [completion](https://www.1password.dev/cli/reference/commands/completion). D: one parameterized leaf.

| Path and operands | Local flags | Observable contract |
| --- | --- | --- |
| `completion <shell>` | None listed | Shell source text for `bash`, `zsh`, `fish`, `powershell`; verify generated script bytes and completion callbacks independently for each shell. |

### Connect

Source: [connect](https://www.1password.dev/cli/reference/management-commands/connect). D: 13 leaves, with `group`, `server`, `token`, and `vault` parents.

| Path and operands | Local flags | Observable contract |
| --- | --- | --- |
| `connect group grant` | `--all-servers`, `--group group`, `--server server` | Server-management grant; omitted server can grant Secrets Automation manager status. |
| `connect group revoke` | `--all-servers`, `--group group`, `--server server` | Revoke management access. |
| `connect server create <name>` | `-f/--force`, `--vaults strings` | Create server plus `1password-credentials.json` in cwd; overwrite confirmation. |
| `connect server delete [name or ID or -]` | None listed | Invalidate server credentials and tokens. |
| `connect server edit <name or ID>` | `--name name` | Rename server. |
| `connect server get [name or ID or -]` | None listed | Server details. |
| `connect server list` | None listed | Server collection. |
| `connect token create <tokenName>` | `--expires-in duration`, `--server string`, repeatable `--vault string` | Issue secret token; vault selector may have `,r` or `,w`. |
| `connect token delete [token]` | `--server string` | Revoke token; release notes also document piped input. |
| `connect token edit <token>` | `--name string`, `--server string` | Rename token. |
| `connect token list` | `--server server` | Active and revoked records; `integrationId` identifies server. |
| `connect vault grant` | `--server string`, `--vault string` | Extend server vault access. |
| `connect vault revoke` | `--server server`, `--vault vault` | Remove server vault access. |

Connect administration is distinct from authenticating through a Connect backend. Built-in Personal/Private/Employee vault access is restricted. The token-create example still uses `--vaults`; the flag table and historical correction specify repeatable `--vault`. Do not silently accept the obsolete example as an alias without a binary check.

### Documents

Source: [document](https://www.1password.dev/cli/reference/management-commands/document). D: five leaves.

| Path and operands | Local flags | Observable contract |
| --- | --- | --- |
| `document create [file or -]` | `--file-name name`, `--tags list`, `--title title`, `--vault vault` | Upload bytes from file/stdin; documented default vault Private. |
| `document delete [name or ID or -]` | `--archive`, `--vault vault` | Archive or delete document item. |
| `document edit <name or ID> [file or -]` | `--file-name name`, `--tags list`, `--title title`, `--vault vault` | Replace document bytes/metadata; empty tags clears tags. |
| `document get <name or ID>` | `--file-mode mode`, `--force`, `--include-archive`, `-o/--out-file path`, `--vault vault` | Raw document bytes, terminal binary guard, file overwrite behavior; file mode defaults to `0600`. |
| `document list` | `--include-archive`, `--vault vault` | Document metadata collection. |

### Environments (beta)

Source: [environment](https://www.1password.dev/cli/reference/management-commands/environment). D: one leaf.

| Path and operands | Local flags | Observable contract |
| --- | --- | --- |
| `environment read <environmentID>` | None listed | Read Environment variables by ID; exact serialization and reveal behavior U. |

Do not invent environment CRUD commands from the generic index description. Include any further nodes found in the beta binary later. Docs associate this feature with beta 2.33.0-beta.02 or later; version gating is a requirement, not a reason to remove it from scope.

### Events API

Source: [events-api](https://www.1password.dev/cli/reference/management-commands/events-api). D: one leaf.

| Path and operands | Local flags | Observable contract |
| --- | --- | --- |
| `events-api create <name>` | `--expires-in duration`, `--features list` | Issue integration token; documented features `signinattempts`, `itemusages`, `auditevents`; Business account requirement. |

### Groups

Source: [group](https://www.1password.dev/cli/reference/management-commands/group). D: eight leaves, including `group user`.

| Path and operands | Local flags | Observable contract |
| --- | --- | --- |
| `group create <name>` | `--description string` | Create group. |
| `group delete [name or ID or -]` | None listed | Delete group. |
| `group edit [name or ID or -]` | `--description string`, `--name string` | Change group metadata. |
| `group get [name or ID or -]` | None listed | Group details; JSON and line-oriented stdin selectors. |
| `group list` | `--user user`, `--vault vault` | Filter by membership or direct vault access. |
| `group user grant` | `--group string`, `--role string`, `--user string` | Role `member` (default) or `manager`. |
| `group user list <group>` | None listed | Membership collection. |
| `group user revoke` | `--group string`, `--user string` | Remove member; docs redundantly list inherited `--help`. |

### Inject

Source: [inject](https://www.1password.dev/cli/reference/commands/inject). D: one leaf.

| Path and operands | Local flags | Observable contract |
| --- | --- | --- |
| `inject` | `--file-mode mode`, `-f/--force`, `-i/--in-file string`, `-o/--out-file string` | Template input from file/stdin; resolved text to stdout/file; output file mode defaults to `0600`. |

### Items and templates

Source: [item](https://www.1password.dev/cli/reference/management-commands/item). D: nine leaves, including `item template`.

| Path and operands | Local flags |
| --- | --- |
| `item create [-] [assignment...]` | `--category category`, `--dry-run`, `--favorite`, `--generate-password[=recipe]`, `--reveal`, `--ssh-generate-key type`, `--tags list`, `--template path`, `--title title`, `--url URL`, `--vault vault` |
| `item delete [name or ID or shareLink or -]` | `--archive`, `--vault string` |
| `item edit <name or ID or shareLink> [assignment...]` | `--dry-run`, `--favorite[=true/false]`, `--generate-password[=recipe]`, `--reveal`, `--tags list`, `--template path`, `--title title`, `--url URL`, `--vault vault` |
| `item get [name or ID or shareLink or -]` | `--fields list`, `--include-archive`, `--otp`, `--reveal`, `--share-link`, `--vault vault` |
| `item list` | `--categories list`, `--favorite`, `--include-archive`, `--long`, `--tags list`, `--vault vault` |
| `item move [name or ID or shareLink or -]` | `--current-vault string`, `--destination-vault string`, `--reveal` |
| `item share <name or ID>` | `--emails list`, `--expires-in duration` (default `7d`), `--vault string`, `--view-once` |
| `item template get [category or -]` | `--file-mode mode` (default `0600`), `-f/--force`, `-o/--out-file string` |
| `item template list` | None listed |

Required semantics: item moves assign a new ID; archive differs from deletion; item JSON and field projections differ; share creates a snapshot link; assignment input overrides template values. Precise mutation/result schemas and all category templates require fixtures. `--fields` selectors include `label=` and `type=`; docs also use bare labels. `--generate-password` defaults to 32 characters; length range 1–64, recipe tokens `letters,digits,symbols`. SSH generation lists `ed25519`, `rsa`, `rsa2048`, `rsa3072`, `rsa4096`, default Ed25519, RSA default 4096 bits. Confirm its optional-value parser behavior from help.

### Shell plugins

Source: [plugin](https://www.1password.dev/cli/reference/management-commands/plugin). D: five leaves.

| Path and operands | Local flags | Observable contract |
| --- | --- | --- |
| `plugin clear <plugin-executable>` | `--all`, `-f/--force` | Clear configurations in scope order; all clears applicable scopes together. |
| `plugin init [plugin-executable]` | None listed | Interactive selection/import and configuration; shell setup text/files. |
| `plugin inspect [plugin-executable]` | None listed | Credential selections, scopes, aliases; interactive selector if omitted. |
| `plugin list` | None listed | Plugin catalog with usage, names, required fields. |
| `plugin run <command>...` | None listed | Provision credentials and execute delegated CLI; prompt if configuration missing. |

Session configuration outranks directory configuration, which outranks global configuration; closer directories win. The initial backend must model these scopes and the catalog, while host execution and import require capabilities/approval. Full plugin behavior includes catalog and provisioning contracts for third-party CLIs; recognizing five verbs alone does not establish parity. The [official shell-plugins repository](https://github.com/1Password/shell-plugins) is the follow-up source for plugin-specific schemas and behavior.

### Read and run

Sources: [read](https://www.1password.dev/cli/reference/commands/read), [run](https://www.1password.dev/cli/reference/commands/run). D: two leaves.

| Path and operands | Local flags | Observable contract |
| --- | --- | --- |
| `read <reference>` | `--file-mode mode` (default `0600`), `-f/--force`, `-n/--no-newline`, `-o/--out-file string` | Secret/file data or selected attribute; default text newline versus `-n`; binary behavior requires fixtures. |
| `run -- <command> [arguments...]` | repeatable `--env-file string`, `--no-masking`; beta Environment selector (see discrepancy ledger) | Spawn with resolved child environment; mask secrets on stdout/stderr unless disabled. |

Run precedence: Environment values, then dotenv files, then inherited shell values; later entries win within repeated files/Environments. Child argv after `--` belongs to the child. Cancellation must reach the child; exit/signal mapping, stdin streaming, and chunk-boundary masking require verification.

### Service accounts

Source: [service-account](https://www.1password.dev/cli/reference/management-commands/service-account). D: two leaves.

| Path and operands | Local flags | Observable contract |
| --- | --- | --- |
| `service-account create <serviceAccountName>` | `--can-create-vaults`, `--expires-in duration`, `--raw`, repeatable `--vault string` | Single-return token; vault syntax `name:permission[,permission]`; raw token or structured result. |
| `service-account ratelimit [name or ID]` | None listed | Hourly/daily usage. |

Vault permissions: `read_items` default, `write_items` and `share_items` require read access. Built-in Personal/Private/Employee vaults cannot be granted. Model expiry, grant dependencies, and one-time token disclosure.

### Sessions, identity, and update

Sources: [signin](https://www.1password.dev/cli/reference/commands/signin), [signout](https://www.1password.dev/cli/reference/commands/signout), [whoami](https://www.1password.dev/cli/reference/commands/whoami), [update](https://www.1password.dev/cli/reference/commands/update). D: four leaves.

| Path and operands | Local flags | Observable contract |
| --- | --- | --- |
| `signin` | `-f/--force`, `--raw` | Idempotent sign-in; app/manual modes differ; session-token or shell-assignment output in manual mode. |
| `signout` | `--all`, `--forget` | Invalidate selected/all sessions; optionally forget account details. |
| `whoami` | None listed | Active human/service/Connect identity; unauthenticated invocation errors. |
| `update` | `--directory path`, `--channel stable/beta` | Update discovery/download; host-controlled filesystem/network effects. |

No real updater or authentication action was exercised. Force on signin concerns warnings/raw output, not approval bypass. The [stable release notes](https://releases.1password.com/developers/cli/) confirm Connect support for `whoami` since 2.29.0, which the older Connect command guide omits.

### Users

Source: [user](https://www.1password.dev/cli/reference/management-commands/user). D: nine leaves, including `user recovery`.

| Path and operands | Local flags | Observable contract |
| --- | --- | --- |
| `user confirm [email or name or ID or -]` | `--all` | Confirm invited users. |
| `user delete [email or name or ID or -]` | None listed | Delete user. |
| `user edit [email or name or ID or -]` | `--name string`, `--travel-mode on/off` | Metadata/travel status; docs display default off, omission semantics U. |
| `user get [email or name or ID or -]` | `--fingerprint`, `--me`, `--public-key` | User record or key/fingerprint projection; `--me` substitutes for selector. |
| `user list` | `--group group`, `--vault vault` | Membership/direct-access filters. |
| `user provision` | `--email string`, `--language string` (default `en`), `--name string` | Invite/provision account user. |
| `user reactivate [email or name or ID or -]` | None listed | Restore active state. |
| `user recovery begin [email or name or ID]` | None listed | Begin recovery; docs example supplies multiple IDs, so exact cardinality U. |
| `user suspend [email or name or ID or -]` | `--deauthorize-devices-after duration` | Suspend and schedule device deauthorization. |

### Vaults and access control

Source: [vault](https://www.1password.dev/cli/reference/management-commands/vault). D: 11 leaves, including `vault group` and `vault user`.

| Path and operands | Local flags | Observable contract |
| --- | --- | --- |
| `vault create <name>` | `--allow-admins-to-manage true/false`, `--description string`, `--icon string` | Omitted admin setting uses account policy. |
| `vault delete [name or ID or -]` | None listed | Delete vault. |
| `vault edit [name or ID or -]` | `--description string`, `--icon string`, `--name string`, `--travel-mode on/off` | On marks vault safe for travel; omission semantics U. |
| `vault get [name or ID or -]` | None listed | Vault record. |
| `vault group grant` | `--group group`, `--no-input`, `--permissions list`, `--vault vault` | Grant group permissions with dependency rules. |
| `vault group list [vault or -]` | None listed | Group access and permissions. |
| `vault group revoke` | `--group group`, `--no-input`, `--permissions list`, `--vault vault` | Partial revoke, or full access revoke if permissions omitted. |
| `vault list` | `--group string`, `--permission permission`, `--user string` | Filter vault visibility/access; release-only `--filter` is U below. |
| `vault user grant` | `--no-input`, `--permissions list`, `--user user`, `--vault vault` | Grant user permissions with dependency rules. |
| `vault user list <vault>` | None listed | User access and permissions. |
| `vault user revoke` | `--no-input`, `--permissions list`, `--user user`, `--vault vault` | Partial/full user revoke. |

`--no-input` is rendered as `--no-input input` in the reference; verify boolean/value syntax. Permission families: `allow_viewing`, `allow_editing`, `allow_managing`; granular names: `view_items`, `view_and_copy_passwords`, `view_item_history`, `create_items`, `edit_items`, `archive_items`, `delete_items`, `import_items`, `export_items`, `copy_and_share_items`, `print_items`, `manage_vault`. Account tier changes validity/dependencies. The complete icon keyword set and permission dependency graph remain required schema inputs from [vault reference](https://www.1password.dev/cli/reference/management-commands/vault) and [vault permissions](https://www.1password.dev/cli/vault-permissions), not free-form strings assumed valid.

## Release-only additions, aliases, and discrepancies

The 76 D leaves are the complete current indexed tree, **not proof of the complete executable tree**. All entries below are in scope until a pinned binary resolves availability. Sources: [stable release notes](https://releases.1password.com/developers/cli/), [beta release notes](https://releases.1password.com/developers/cli-beta/), [historical downloads](https://app-updates.agilebits.com/product_history/CLI2).

| Surface | Evidence and outstanding requirement |
| --- | --- |
| `provisioning configure` | R: beta June 9, 2026. Missing from index. Capture full operands, flags, prompts, config artifacts, and results. |
| `provisioning google sync` | R: 2.38.0-beta.01, July 14, 2026. Preserve `provisioning` and `google` parent help; inputs/output U. |
| `user create` | R: June 9, 2026 beta supports automated provisioning. Do not assume alias or same arguments as `user provision`. |
| `account use` | R: 2.6.0-beta.05, July 15, 2022. Historical default-account selection; current availability, operands, and flags U. |
| `list` → `ls`; `delete` → `remove`, `rm` | R: CLI 2 release history. Verify aliases per parent and whether help/completion advertises them. |
| `item get --field` | R: alias of `--fields`; verify current acceptance and error/help spelling. |
| `item share --expiry` | R: alias of `--expires-in` in 2.26.0; retain in compatibility discovery. |
| `vault list --filter` | R: 2.31.0 mentions it; absent from reference table. Type/grammar and current availability U. |
| `run --environment` versus `--environments` | D prose says plural; example and precedence use singular. R recent beta help fixes use singular. Capture beta help and test both spellings; neither silently becomes a proven alias. |
| Beta version labels | June 9 additions are labeled 2.36.0-beta.02 on releases.1password.com and 2.36.0-beta.03/build 2360003 in download history. Preserve discrepancy and pin executable hash. |
| `user get --publickey` | Stale example conflicts with `--public-key`; release history explicitly records correction. Do not assume alias. |
| Item categories | Item command page lists 19 categories; item-fields page lists 22 including Crypto Wallet, Medical Record, SSH Key. Actual template catalog U. |
| `connect token create --vaults` | Stale example conflicts with repeatable `--vault` and historical rename. |
| `user recovery begin` cardinality | Single optional operand in usage; multiple IDs in example. |
| Secret template scanning | Template guide describes allowed bare-reference characters without `/`, despite slash-containing examples. Resolve actual scanner grammar with fixtures. |
| Service-account access | Guide contains a broad unsupported `group` entry but separately allows `group get/list`; item-get vault requirement wording differs between guides. Capture actual per-operation rules. |
| Root/version/completion internals | Help topics, hidden commands, aliases, version flags, and completions are not exhaustively documented. U until isolated binary help traversal. |

Historical names `plugin install`, `plugin configure`, `plugin get-started`, `user invite`, and `events create` must not be automatically reintroduced. Release history explicitly replaces/removes several; current binary determines alias rejection. CLI 1 grammar and removed `events list` are not assumed to be CLI 2 features. Every discovery must be classified as current stable, current beta, historical, or unresolved.

## Environment, authentication, and configuration formats

Source: [environment variables](https://www.1password.dev/cli/environment-variables). All documented variables must be recognized through supplied execution context, never ambient credential discovery by default.

| Variables | Contract |
| --- | --- |
| `OP_ACCOUNT`, `OP_CONFIG_DIR` | Account/config defaults overridden by corresponding flags. |
| `OP_BIOMETRIC_UNLOCK_ENABLED` | Boolean app-integration toggle. |
| `OP_CACHE`, `OP_DEBUG`, `OP_ISO_TIMESTAMPS` | Boolean controls; documented defaults true, false, false respectively. |
| `OP_FORMAT` | `human-readable` or `json`. |
| `OP_INCLUDE_ARCHIVE` | Boolean archive inclusion, default false; commands document applicability. |
| `OP_CONNECT_HOST`, `OP_CONNECT_TOKEN` | Connect authentication pair. |
| `OP_SERVICE_ACCOUNT_TOKEN` | Service-account authentication. |
| `OP_SESSION` | Manual-session token; account-specific session variable naming also needs manual sign-in fixtures. |
| `OP_RUN_NO_MASKING` | Disable run output masking. |

Connect variables outrank service-account authentication according to [service-account usage](https://www.1password.dev/service-accounts/use-with-1password-cli). App sign-in selects explicit account, then `OP_ACCOUNT`, then most recently signed-in account. Complete precedence across manual sessions, app mode, incomplete Connect settings, expired tokens, and conflicting flags remains U. Auth mode and backend capability must not be conflated: the object backend must support human/admin fixtures as well as constrained service/Connect fixtures.

The [config-directory guide](https://www.1password.dev/cli/config-directories) gives this search order: `--config`, `OP_CONFIG_DIR`, `~/.op`, `${XDG_CONFIG_HOME}/.op`, `~/.config/op`, `${XDG_CONFIG_HOME}/op`. Creation defaults are `${XDG_CONFIG_HOME}/op` when XDG is set, otherwise `~/.config/op`. Model this in a virtual filesystem. Existing-directory selection, permissions, config JSON schema, migration, and OS variations require fixtures; do not read the host's real config to infer them.

Authentication compatibility includes session creation/expiry/signout, selected identity, biometric approval outcomes, server-issued-token errors, permissions, account tier, and unavailable authentication modes. The older [Connect usage guide](https://www.1password.dev/connect/cli) only lists run/inject/read/item-get JSON, while stable release notes add whoami. Unsupported modes are observable failures to emulate, not operations to remove from the command parser.

## Input, output, and data compatibility

### Output families

| Family | Commands and required coverage |
| --- | --- |
| Human records and tables | Account, Connect, group, item, document metadata, vault, user, service-account, plugin, whoami results. Capture headers, ordering, alignment, missing fields, Unicode, dates, color, TTY width, and concealment. |
| JSON records/collections | Capture each command separately, including empty results, one versus multiple stdin objects, absent versus null, enum case, number/string types, ordering where observable, token results, and error streams. Do not substitute SDK/Connect REST schemas for CLI JSON. |
| Field projections | Item-get single/multiple fields, CSV output in human mode, JSON projections, OTP and share-link output. Test escaping of commas/quotes/newlines and order. |
| Raw text and bytes | Read, document-get, inject, template-get files/stdout. File bytes must survive without text decoding or invented JSON wrappers. Document-get must not append a newline (release history). |
| Secret token or URL | Account-add/signin raw sessions; service-account, Connect, Events tokens; item share URLs. Capture exact raw/JSON/human differences and one-time return behavior. |
| Shell source | Completion, manual signin assignments, plugin setup. Shell and OS quoting are part of compatibility. |
| Child streams | Run/plugin-run forward streams with documented masking; preserve exit status/cancellation and do not wrap stdout in a status object. |
| Diagnostics/prompts | Help, usage, validation, ambiguous selector, access denial, cancellation, missing capability, overwrite, authentication, rate limit, update. Exact stderr placement, status, newline, and partial-output behavior U. |

Known stable behavior includes default concealment of sensitive item fields in human output since 2.30.0, `--reveal` to expose them, and JSON examples containing values. A blanket renderer that masks every JSON field would break compatibility. Host policy may deny disclosure before formatting; that denial must be explicit rather than silently returning altered success data. Sources: [stable releases](https://releases.1password.com/developers/cli/), [item reference](https://www.1password.dev/cli/reference/management-commands/item).

### Structured items and selectors

Sources: [item JSON template](https://www.1password.dev/cli/item-template-json), [item fields](https://www.1password.dev/cli/item-fields), [item reference](https://www.1password.dev/cli/reference/management-commands/item).

The model must preserve identity, title, category, version, vault identity/name, editor and timestamps, sections, fields, URLs, tags, favorites, archive/deletion state, file metadata and bytes, and category-specific data. Template keys include `title`, `category`, `sections[{id,label}]`, and `fields[{id,section:{id},type,label,value}]`; returned items add metadata and field secret references. Built-in fields have purposes and possibly password metadata. Unknown category-specific properties cannot be discarded by a narrow secrets dictionary.

Assignment syntax is `[section.]field[[fieldType]]=value`; escape `.`, `=`, and backslash in selector names, not in values. Built-ins use their field IDs. Updates can preserve omitted type/value; `[delete]` deletes custom fields; empty sections disappear; built-ins can be cleared but not deleted. Template and piped-template input conflict; assignments override template content. Implement parsing, not regex replacement.

Custom assignment types map to JSON types: `password:CONCEALED`, `text:STRING`, `email:EMAIL`, `url:URL`, `date:DATE`, `monthYear:MONTH_YEAR`, `phone:PHONE`, `otp:OTP`; `file` represents an attachment, not a normal field type. Built-ins can have other types such as `MENU`. Date syntax is `YYYY-MM-DD`; month/year supports `YYYYMM` and `YYYY/MM`. Passkey/template round-trip limitations are documented and must be explicitly covered before claiming lossless parity.

The 22-category inventory from item-fields is API Credential, Bank Account, Credit Card, Crypto Wallet, Database, Document, Driver License, Email Account, Identity, Login, Medical Record, Membership, Outdoor License, Passport, Password, Reward Program, Secure Note, Server, Social Security Number, Software License, SSH Key, Wireless Router. Full built-in templates and accepted category aliases/case require binary fixtures.

Selectors must cover names versus IDs, duplicate names, archive visibility, sharing links where accepted, vault filters, per-command stdin forms (lines, JSON object streams, arrays), missing IDs, and piped vault context. IDs are generally 26 alphanumeric characters; do not apply that assumption to every Environment/token/link identifier. Item movement changes ID. Multi-object failure ordering and transactional behavior are U.

### Secret references, templates, and dotenv

Sources: [secret reference syntax](https://www.1password.dev/cli/secret-reference-syntax), [template syntax](https://www.1password.dev/cli/secrets-template-syntax), [run](https://www.1password.dev/cli/reference/commands/run).

Reference grammar: `op://vault/item/[section/]field-or-file`, name/ID segments, optional query. Documented name matching is case-insensitive and permits letters, digits, hyphen, underscore, dot, whitespace; unsupported name characters require IDs. Field query `attribute`/`attr`: `type`, `value`, `id`, `purpose`, `otp`; file query: `type`, `content`, `size`, `id`, `name`. `ssh-format=openssh` requests OpenSSH private-key encoding. Native/default and PKCS1 behavior require key fixtures.

Injection includes bare and `{{ ... }}` references, quoted literal escapes, `$VAR`, `${VAR}`, `${VAR:-default}`, whitespace, and missing-variable behavior. Dotenv support needs quoting, comments, multiline values, expansion, duplicate keys, multiple files, malformed syntax, CRLF/BOM, empty versus unset values, and non-reference variables. Treat reference parsing, template parsing, and dotenv parsing as distinct grammars. Do not evaluate their content as host shell code.

## Original standalone architecture and host approvals (delivery superseded)

The current plugin delivery contract at the start of this inventory supersedes
the no-integration and separate-public-package instructions in this historical
section. Core approval invariants remain required; the shell adapter composes
the internal engine with explicit VFS and nested-invocation capabilities.

These are project requirements/design constraints, not claims about official CLI internals.

1. `packages/op` owns command declarations, parsing, execution semantics, formatting, and public SDK. A thin CLI invokes that SDK. No safe-bash imports, registration, execution hooks, or integration changes belong to this work.
2. Backend selection is configuration/dependency injection. Shared command handlers depend on typed domain operations, not backend-name branches. An object backend is the first real implementation; future adapters must not require rewriting the CLI grammar or renderers.
3. Object state represents accounts/sessions, users/groups and membership, vault ACLs, items/categories/templates/attachments, Environments, Connect servers/tokens/grants, service accounts/rate usage, Events integrations, share snapshots, provisioning state, plugin catalog/configuration, and update metadata. A flat reference-to-string map cannot provide full coverage.
4. Model operations and state transitions faithfully: IDs/versions, archive/recently-deleted distinctions, permission dependencies, invitations/recovery/suspension, token expiry/revocation, moves, share expiry/view-once, and selection precedence. Inject clock and randomness to make fixtures reproducible without reducing runtime correctness.
5. Distinguish domain backend from host capabilities: virtual file IO, process launch, network/download, interactive prompts, app authentication, entropy/crypto, and approval/audit. Initial tests use object state and memfs; no ambient host filesystem, processes, credentials, or network fallback.
6. Host approval occurs before secret disclosure, protected reads, mutations, credential import/export, external sharing/provisioning, file writes, app authentication, process execution, and updates, according to host policy. Read metadata can itself be sensitive. The host can preauthorize scope; commands cannot grant themselves permission.
7. Approval input binds the canonical operation, selected account/backend, resolved target identities, mutation intent, output destination, and child executable/argv/environment names. Redact secret values, tokens, passwords, and secret-bearing assignments from the approval description and audit log. Target changes invalidate approval. Define cancellation, timeout, denial, batch requests, and retries explicitly.
8. `--force`, `--raw`, `--reveal`, `--no-masking`, and `--no-input` alter official CLI behavior only; they do not bypass host authorization. The SDK must use the same approval path as the CLI. Renderer output cannot accidentally serve as the approval decision.
9. No approved action means no mutation, child launch, secret output, or credential-bearing file write. For unsupported external capabilities, return an explicit failure; never report a simulated remote success as a real operation. Object-backed lifecycle effects are local simulation and must be described as such by the embedding API.
10. Preserve the full command interface even where a host lacks a capability. Capability failures are not implementation-complete parity. Help, parsing, domain behavior, and available object-backed effects still need implementation for every row.

## Verified native 2.39.0 oracle follow-up

Following explicit authorization, downloaded only the [Darwin arm64 ZIP linked from official release history](https://cache.agilebits.com/dist/1P/op2/pkg/v2.39.0/op_darwin_arm64_v2.39.0.zip) into ignored `out/op-oracle`. Verified `op.sig` against `op` with GPG using fingerprint `3FEF9748469ADBE15DA7CA80AC2D62742012EA22`, matching the [official CLI verification guide](https://www.1password.dev/cli/verify). The public key came from the [official distribution key endpoint](https://downloads.1password.com/linux/keys/1password.asc). GPG reported GOODSIG/VALIDSIG, and macOS `codesign --verify --strict` also passed, before executing the binary. A fresh local keyring has no owner-trust certification; authenticity is established by the independently documented fingerprint, not by setting arbitrary owner trust.

Archive SHA-256: `05391d3388a0c0b4f602691bedc1ab368541c487b6f14d2e3399743b4682af67`. Executable SHA-256: `f48b97df4dfdccc67483587b40a596f70881eac05a576de7b7775d267375757a`. These are recorded artifact hashes, not claims of a publisher checksum manifest. Both `--version` and `-v` returned `2.39.0`.

All invocations used an explicit empty 0700 config, fresh child environment, isolated HOME/XDG/TMPDIR, app integration disabled, cache disabled, closed stdin, and timeouts. A macOS sandbox denied network, real user-home reads outside the owned artifact subtree, and writes outside that subtree. No installation or authentication occurred. Help invocations covered account/signin/read names only with help; no data command in those families executed.

Evidence index: `out/op-oracle/EVIDENCE.md`; provenance/signature/hashes under `out/op-oracle/evidence`; exact stdout/stderr/argv/status under `out/op-oracle/captures`. `native-command-tree.json` and `native-help-schema.json` contain the recursively discovered visible command tree, help usage, local flag spellings, aliases, and capture paths. Raw help retains all continuation lines. This closes visible stable help discovery, not undocumented hidden commands or authenticated behavior.

**The native visible stable tree has 76 leaves across 18 top-level families.** It equals the 76-leaf documentation tree with `environment read` removed and **`plugin credential import` added**. Equal counts conceal a real command mismatch.

| Native finding | Verified evidence / catalog consequence |
| --- | --- |
| Missing stable command: `plugin credential import <plugin-name>` | Advertised under `plugin credential`; captured leaf help. Only local flag is inherited/help `-h/--help`. Import can discover filesystem/environment credentials or prompt, so it needs its own host approval and backend contract. No import was executed. |
| Stable has no `environment` or `provisioning` root | Both root help probes exit 1 with unknown-command errors. Keep the documented/beta surfaces in the overall goal, gated separately from stable. |
| Stable rejects `run --environment` and `--environments` | Help probes with synthetic values exit 1, unknown flag. They must not be accepted as stable 2.39.0 flags. |
| Root `-v/--version` exists | Native root help and both version invocations confirm it; not in the original reference global table/catalog. |
| `account use` and `user create` are not advertised | Their help probes return their parent usage with exit 0, not command-specific help. Do not interpret that as command existence. Actual data invocations were deliberately not used to establish rejection. |
| `vault list --filter` rejected | Synthetic help probe exits 1. Release-note mention does not make it an accepted stable flag. |
| `item get --field` accepted | Help probe exits 0; hidden alias of fields supported by release evidence. |
| `item share --expiry` accepted | Help probe exits 0; hidden alias of expires-in supported by release evidence. |
| `document get -f` rejected | Native force has no short alias; probe exits 1. The inspected shared catalog force definition incorrectly gives this command `-f`. |
| `item create --ssh-generate-key` requires a value | Placing `--help` next consumes it as the key type and errors, unlike an optional-value flag. Current catalog kind `optional` needs correction against this evidence. |
| `vault user grant --no-input --help` accepted | Confirms bare boolean form despite the `input` metavar in help. |
| Default item vault is account-dependent | Native create help says Private, Personal, or Employee depending on account type; do not always assume Private. |
| Native template help lists 20 categories | Includes SSH Key, excludes Crypto Wallet and Medical Record from its displayed list. This differs from both the 19-name command webpage and 22-name fields webpage; runtime template enumeration is still blocked. |

Native command aliases observed in help:

- `ls`: account list; connect server/token list; document list; group list; group user list; item list; item template list; plugin list; user list; vault list; vault group/user list.
- `remove`, `rm`: connect server/token delete; document delete; group delete; item delete; user delete; vault delete.
- `mv`: item move. `reset`: plugin clear. `info`: plugin inspect. `ratelimits`: service-account ratelimit.

The native plugin-import help also enumerates 89 bundled plugin executable/display-name entries, extracted into `out/op-oracle/evidence/native-plugin-catalog.json`. It does not provide every credential field/provisioning schema. Final validation checked 122 capture metadata files for authorized argv and completed processes, rechecked the binary hash, and confirmed oracle artifacts are ignored.

**Template/schema blocker:** with isolated config mode 0700, both `item template list --format json` and `item template get Login --format json` exit 1 because no accounts are configured. The earlier too-broad-config failure was retained separately. No native template JSON was obtained and no credentials were supplied to bypass this boundary. Exact authenticated item/account/user/token/Environment JSON schemas remain outstanding; help/category examples must not be presented as observed successful result schemas.

Remaining native work: selected beta oracle if separately requested, hidden-command discovery without executing data operations, exhaustive parser/type/default probes, and authorized synthetic-account template/output fixtures. Current captures provide exact native help/diagnostic bytes and the concrete stable command/alias discrepancies needed to assign implementation work now.

## Current implementation comparison and assignment handoff

Read-only snapshot on 2026-09-07 of concurrently changing `packages/op/src/catalog.ts`, `cli.ts`, `backend.ts`, `index.ts`, `types.ts`, and secret handlers. These are source-inspection findings, not executed regression tests. No implementation file was edited. Recheck before assigning work because other authors are active.

**Initial docs-to-catalog result: all 76 indexed canonical leaves are present.** The native follow-up above additionally identifies missing stable `plugin credential import`, missing aliases/version handling, and unsupported stable Environment acceptance. Most domain-specific semantics are not provided by generic resource CRUD.

Concrete command discovery queue missing from catalog: `provisioning configure`, `provisioning google sync`, `user create`, `account use`. The first three have recent beta release evidence; account-use has historical beta evidence only. Verify current availability and syntax before adding them. Missing alias discovery queue: per-parent `ls`, `remove`, `rm`; `item get --field`; `item share --expiry`; `vault list --filter`. Root `--version` is absent from global definitions. `help` is handled specially by the parser, so it is not a missing command merely because it has no catalog row.

Flag discrepancies: catalog accepts both `run --environment` and `--environments` without a stable/beta distinction; their alias relationship is not established. It adds `OP_NO_COLOR`, which is absent from the official environment-variable reference. It omits the documented `OP_RUN_NO_MASKING` binding on `--no-masking`, and the inspected run handler checks only the parsed flag. The catalog has no version/channel, operand cardinality, defaults, enum constraints, or command aliases in its schema. These are concrete verification/metadata tasks, not proof that every associated runtime behavior is wrong. Repeatable `--vault` on token/service-account create is already modeled correctly.

| Assignment | Current concrete evidence / remaining backend work |
| --- | --- |
| Accounts and sessions | Generic backend rejects `account add/forget`; singleton signin/signout/whoami requests have an empty action and hit the unsupported-action guard. Account get currently requires an object selector although CLI takes none. Implement auth state, account selection, session/raw/shell output and lifecycle. |
| Groups, users, ACLs | Grant/revoke, confirm/provision/reactivate/suspend/recovery-begin are rejected by the action guard. Generic create requires object input outside item/vault, so normal named group creation/provisioning semantics are absent. Implement memberships, roles, ACL dependency/tier rules, direct-versus-inherited filters, user lifecycle, and beta provisioning. |
| Connect, Events, service accounts | Generic resources can hold records, but named creation/token issuance, credential files, expiry, revocation, server/vault grants, and ratelimit are not modeled. Implement all 13 Connect leaves plus Events and both service-account leaves, including their permissions and secret outputs. |
| Documents and item templates | Generic document create expects object input rather than binary file/stdin; generic non-item delete removes records and does not model document archive. Template resources have no built-in category catalog. Implement bytes/metadata separation, file mode/overwrite, document lifecycle, all templates and output formats. |
| Item advanced behavior | Basic item CRUD/filter/move exists. Source explicitly rejects SSH generation, OTP generation, and reference SSH-format/OTP transformations. Item share hits unsupported-action guard; get share-link has no dedicated branch. Complete category data, cryptographic transforms, share snapshots, version/timestamp behavior, projections, and authenticated oracle validation. |
| Environments and run | Secret handlers provide read/inject/run, but object backend rejects `environment read`. Run expects the Environment backend to return dotenv text, an unverified format assumption. Complete Environment storage/read serialization and run precedence/masking/env toggles with the beta oracle. |
| Plugins and update | No built-in plugin handler is registered by createOp; generic backend rejects clear/init/inspect/run, while list alone can expose seeded rows. Root update has an empty action and is rejected. Implement catalog/config scopes, import, host execution, and update discovery/download adapters. |
| CLI/output/approvals | Catalog accepts names independently of full backend support. createOp registers secret handlers and completion, then caller overrides; other commands reach generic backend. Verify per-command output and IO, stdin batches, aliases, defaults, status/help, and host authorization scope. Current authorization receives the raw request including flag/input values, so secret-safe prompt/audit projection and resolved-target binding need explicit work. |

Fast assignment order: (1) native stable/beta help discovery and catalog metadata; (2) accounts/users/groups/vault ACLs; (3) Connect/Events/service accounts; (4) documents/templates/item advanced semantics; (5) Environments/plugins/update; (6) independent output/approval verification. All teams use the same versioned inventory; passing a catalog-count test does not discharge backend coverage.

## Outstanding requirements and acceptance gates

| ID | Requirement | Exit evidence |
| --- | --- | --- |
| OP-01 | Pin stable 2.39.0 and selected beta executable separately, including platform and checksum. | Recorded version/hash and official download provenance; do not mistake current docs for version-specific help. |
| OP-02 | Traverse full root/parent/leaf help and aliases in an empty, isolated config with no OP credentials or app integration. | Manifest containing every executable command, accepted alias, operands, local/inherited flag types, defaults, enum values, version gates; reconcile all U/R rows. |
| OP-03 | Capture unauthenticated parser/help/version/completion behavior and validate every reference row against it. | Golden stdout/stderr/status fixtures, including incorrect invocations and all shell completions. No credential access. |
| OP-04 | Obtain explicitly authorized synthetic-account oracle coverage for authenticated behavior later. | Sanitized output and state-transition fixtures across human/admin, service-account, Connect, app, and beta Environment modes. This investigation authorizes no credential access. |
| OP-05 | Specify per-command schemas and format matrix, including full category templates, plugin catalog, icon enum, permission dependencies, binary output and tokens. | No row without success/error/stdin/format fixtures or an explicit unresolved blocker. |
| OP-06 | Implement package SDK/CLI parity and object backend using TDD. | Failing contract test before implementation; narrow maintained workspace tests pass; memfs and injected dependencies keep unit tests fast and offline. |
| OP-07 | Implement host capability and approval contracts for every effect. | Denial/cancel/timeout tests prove no disclosure or side effect; tests cover aliases, batch stdin, SDK calls, force/reveal/no-masking and races. |
| OP-08 | Complete process/file/auth lifecycle behavior. | Stream/cancellation/status fixtures, scoped child environment, secret masking across chunks, file mode/overwrite and cleanup coverage. |
| OP-09 | Verify UI and documentation. | Ad hoc CLI screenshots for help/prompts/errors; no screenshot tests. Package README must document all configuration/env options under the repository's README permission rule. |
| OP-10 | Prepare and deliver requested standalone package release. | Confirm package name/exports/bin and maintained publishing route from `docs/development/NPM_PUBLISHING.md`; do not assume pushing root publishes a new package. Include scoped lint/build/tests before push. |
| OP-11 | Verify delivery separately from implementation. | Report local commit, remote-main matching commit, successful GitHub release/publication and registry artifact separately; monitor build after any push until release succeeds. No local publish, no branch, no blanket staging, no unrelated edits. |

Manual QA is a Markdown procedure: inspect both versioned help trees; compare every manifest row and format with fixtures; exercise the standalone CLI using synthetic objects; inspect screenshots; inspect approval allow/deny/cancel flows; verify state and IO after each operation; then execute the maintained publication workflow and verify the artifact. This document creates no QA script or workflow tests.

Completion requires closing the unresolved executable-interface and behavioral gaps, not merely accepting command names. An object backend can cover the whole domain interface while real authentication, remote sharing, provisioning, plugin execution, and updating remain host-capability-dependent; those limitations must be reported explicitly. As of this investigation there is **no implementation verification, no local commit, no verified remote-main delivery, and no verified release produced by this task**.

### Subsequent implementation checkpoint

The source-inspection table above is historical, not the current completion
status. The standalone package now builds, and the latest package unit run has
276 passing tests. Packed CLI/SDK smoke checks previously passed, including an
environment snapshot round trip. These checks do not establish full native
behavioral parity. Authenticated schemas and other listed acceptance gaps remain
open until independently verified.

A failing public-factory regression demonstrated that configured object-backend
hooks for `item share`, `update`, and `plugin credential import` were unreachable.
The dispatcher now checks configured hooks before restricting built-in resource
ownership. Public SDK tests cover these paths, missing capabilities, authorization
denial, success, and cancellation before snapshot commit/output. External sharing,
update installation, and credential discovery still require actual host
implementations; the object backend does not fabricate their successful effects.

No task commit, remote-main delivery, or release has occurred. The package README
permission remains outstanding and is the sole package-lint violation at this
checkpoint. Environment variable snapshots are implemented; broader shell-state
scope remains a separate unanswered clarification.

The following ID regression was subsequently reproduced and fixed: administrative
creation generated seven-character `admin-N` identifiers instead of the documented
26-character identifiers. Admin allocation now checks all local collections and
item child IDs case-insensitively and generates 26-character IDs. Sixteen scoped
admin/identity tests pass. This is object-store identity behavior, not a claim
that local identifiers are credentials or reproduce upstream entropy.

Global `--encoding` remains under active investigation: the CLI currently accepts
it while text processing remains UTF-8. Native sandbox probes and a separate
implementation assignment are in progress; neither is an acceptance pass yet.

## Independent completion audit — current source, 2026-09-07

This is a fresh read-only audit, not a replacement for the historical inventory. In-memory probes used synthetic objects through the current SDK; no credentials, real providers, or remote services were accessed. The repaired generic hook dispatcher and 26-character admin IDs are not outstanding findings. The three existing child-close-on-abort tests now pass (masked run, unmasked run, snapshot restore). Encoding remains Newton's active assignment and needs its own final checkpoint.

### Ranked implementation gaps

1. **High — account selection does not constrain object operations. Reproduced.** Seed accounts `a`/`b` and groups `ga`/`gb` carrying their corresponding `account` values: `group list --account a` returns both, and `group delete gb --account a` deletes `gb`. `admin.ts` resolves accounts for account/session commands but its group/user/relationship collections are unscoped; `backend.ts` likewise resolves vaults globally. This is incorrect operation targeting even with a trusted object backend, not proof of a remote authorization exploit. Establish one account-selection/scoping contract for reads, mutations, relationships and default vault selection before expanding administrative behavior.

2. **High — supplied object Environments cannot compose with beta run. Reproduced.** With `resources.environment = [{id: "prod", variables: {KEY: "synthetic"}}]`, public `createOp({channel: "beta", backend})` executing `run --environment prod -- worker` exits 1 without spawning: `Backend environment read must resolve to dotenv text`. `admin.ts` returns the variables object; `secrets.ts` requires a string. Agree a backend Environment result contract and cover public object-backed composition. This is separate from the working `environment snapshot` extension and does not require authenticated access to fix.

3. **High — documented batch operand behavior is incomplete. Reproduced/source-evidenced.** Public `vault get -` with stdin `[{"id":"v"}]` and an existing vault `v` fails with `Object not found`; generic `backend.ts` treats `-` as a literal selector. In `admin.ts`, relationship lists use only `selectors(request)[0]`, so batches are not uniformly honored there either. Audit documented batch commands through public handlers, not just selector-helper unit tests. [Official vault operands](https://www.1password.dev/cli/reference/management-commands/vault).

4. **Medium/high — administrative metadata is not yet the complete domain model. Source-evidenced.** Vault grants union/subtract a flat permission set without dependency rules; Connect vault grants have no built-in-vault restriction; sessions have no expiry/idle validation; plugin clear simply deletes `configuration`, ignoring session/directory/global precedence and the distinction between single-scope and `--all` clearing. `plugin inspect` without an operand also fails rather than offering selection (reproduced). These are implementation gaps; exact native account-plan, prompt and response details still need oracle evidence. [Vault permission rules](https://www.1password.dev/cli/reference/management-commands/vault), [plugin scope rules](https://www.1password.dev/cli/reference/management-commands/plugin).

5. **Medium — interface coverage exceeds implemented presentation/configuration behavior. Source-evidenced.** `--iso-timestamps`, `--cache`, `--config` and `--debug` are accepted/forwarded but have no corresponding built-in object/Node behavior. `helpText` has no native descriptions/examples/default metadata, and most human output is a generic key/value or tab-separated dump. Completion generation handles canonical literal paths but not argument-aware parsing or command aliases. These need explicit compatibility fixtures; accepting flags and matching 76 canonical leaves does not establish their effects or native output parity.

### Capability and evidence gates, distinct from local defects

- **Remote functionality:** authentication, provisioning/recovery, Connect credentials/tokens, service accounts, Events tokens, sharing, plugin import/run and updating now have reachable injected hooks. There are no bundled real adapters for these effects. Hooks are a valid pluggable boundary, but hook tests cannot establish native authentication, token expiry/disclosure, remote URLs, credential-file creation or updater behavior. Full regular-op replacement claims require implementations plus authorized synthetic-account fixtures; an object-only release must disclose the capability boundary.
- **Authenticated evidence:** the pinned stable manifest tests verify command/flag/alias structure, not authenticated JSON schemas, prompts, permissions, app/service/Connect identity modes, plugin provisioning or beta Environment serialization. No new authenticated evidence was collected by this audit. Broader shell-state snapshots beyond variables remain an unanswered scope question, not a failed implementation test.
- **Standalone delivery:** `.github/workflows/release-op.yml`, package exports/bin and LICENSE exist. `packages/op/README.md` is still absent; the workflow runs `lint:packages`, whose `package-readme-required` rule rejects that absence. README permission remains required. Initial registry authorization/trusted-publisher setup, successful GitHub publication and installed-artifact verification are delivery evidence still to obtain, not source-proven failures. Do not claim a release from a passing local pack.

Recommended next implementation order: account-scoped targeting, the object Environment/run contract, then public batch selectors. In parallel, root can resolve the README/release gate and arrange authenticated fixtures. Do not reopen fixed hook/ID/lifecycle findings or duplicate Newton's encoding work.

### Follow-up verification

Account-scoped targeting and the object Environment/run contract now have public
integration regressions and fixes. Account tests cover foreign IDs, duplicate
vault names, scoped hook snapshots/results, nested arbitrary metadata,
repeatable vault flags, globally unique IDs, and concurrent updates. Binary
attachment `read` and numeric size attributes also have focused coverage.
Encoding now uses a portable dependency with the native-verified label and
validation-order matrix; successful authenticated byte conversion remains an
evidence gap.

The full package checkpoint passes 319 tests, package lint/typecheck, and the
maintained selected-workspace build. A fresh packed installation passes CLI
version, GBK conversion, and account-scoped SDK smoke checks. The account-filtered
CLI list screenshot was inspected. Batch selectors and the other unresolved
audit items remain open. No commit, push, or release has been performed.

The next checkpoint implements stdin batches for vault get/delete, item
get/delete/move, and documented vault relationship lists using the shared
selector parser. Public tests cover mixed/malformed inputs, missing/foreign
targets, canonical approval, atomic local mutations, archived IDs, fields, and
OTP projection. Root reproduced and fixed the remaining batch-OTP renderer
failure. The full run passed 334 tests; subsequently added invalid-OTP checks
passed separately. Package lint/typecheck/build and the inspected batch CLI
screenshot passed. Authenticated native output shapes and broader remaining
audit requirements are still unverified; no release or delivery occurred.

The subsequent vault checkpoint validates all 44 native-advertised icon keywords
and Travel Mode values. Permission grants/revocations now enforce the published
dependency graph, expand umbrella permissions, and derive `move_items` without
silently granting prerequisites. The full package run passes 386 tests;
lint/typecheck/build and inspected CLI error screenshots pass. Normalized local
permission storage remains a modeling choice, with account-tier restrictions
and authenticated native prompt/result parity still unverified. README permission
and delivery remain outstanding; no commit, push, or publication occurred.

Plugin defaults now model terminal/directory/global precedence and scoped
clearing, with immutable metadata-only confirmation and cancellation/concurrent
mutation safeguards. The SDK forwards a bound scope to authorization and backend
hooks; the Node host supplies normalized paths and explicit terminal identity.
The full checkpoint passed 426 tests, lint/typecheck/build, and a persisted CLI
scope-clearing screenshot check. A subsequent UNC-root regression was reproduced
using `path.win32` and fixed; 59 targeted host tests plus typecheck/lint pass.
No Windows machine smoke run was performed. Omitted-plugin interactive selection,
authenticated prompt/output parity, and other remaining requirements are still
open. Completion aliases also pass scoped and actual Bash checks. No task commit,
remote-main delivery, or publication has occurred.

Vault batch editing now follows the documented `vault edit -` operand:
stdin supplies selectors only, flags supply changes, and all targets validate
before local mutation. The shared batch-command registry also governs hook
preflight. Regressions cover missing/foreign IDs, irrelevant stdin metadata,
invalid options, and atomic state preservation. The full checkpoint passes 428
tests, lint/typecheck/build, and the inspected batch-edit CLI screenshot.
Session lifecycle schema work remains under review; no expiry implementation
is claimed by this checkpoint. No commit, push, or release occurred.

The managed-authentication and environment-review checkpoint passes 473 package
tests, package ESLint/test typecheck, and the maintained selected workspace
build. Manual sessions require bearer possession; app authorizations bind to
explicit host terminal identity. Persisted lifecycle metadata is validated,
and concurrent revocation/removal/reissue prevents late local publication.
Two independently reproduced security findings drove those admission fixes.
App default-account selection across terminals remains a compatibility gap;
remote authentication and cancellation of external effects remain host-owned.

Snapshot restore now preserves global account/session selectors in nested
requests. Selected shell output neither exposes nor overwrites unrelated
variables and retains explicit unset instructions. Independent synthetic runtime
probes passed in Bash, Zsh, and sh; Fish/PowerShell emission tests pass but those
shells were unavailable for runtime checks. The selected-restore CLI screenshot
was inspected. Node output-file handling now accepts empty regular files without
force, matching the documented document behavior; other handlers share that
policy without an independently verified native claim. Required README
permission and broader full-parity requirements remain open. No local commit,
remote-main delivery, or release has occurred.

A final narrow review reproduced access through suspended users' sessions.
Suspension now invalidates associated manual/app sessions and pending local
operations; persisted suspended seeds and hook updates are covered, and
reactivation does not resurrect credentials. Independent rechecking found no
remaining issue in that scope. The resulting checkpoint passes all 478 package
tests, package lint/test typecheck, and the maintained selected workspace build.
Repository package-policy checks report exactly one violation: the required
package README is missing, awaiting the user's permission to add its content.
No local commit, verified remote-main delivery, or successful release is claimed.

## App account-selection model: evidence and checkpoint boundary

The following distinguishes primary evidence from the approved standalone model.
It does not supersede unresolved native authentication requirements or establish
full parity or release readiness. Final local verification is recorded below.

| Question | Verified primary evidence | Approved model / remaining uncertainty |
| --- | --- | --- |
| App account selection | `--account` → `OP_ACCOUNT` → most recent `op signin` account in any terminal window. [Signin reference](https://www.1password.dev/cli/reference/commands/signin); pinned help `out/op-oracle/captures/signin.stdout:13`. | One app-wide preference within a backend state, separate from terminal authorizations. Native persistence storage/scope is not reproduced. |
| Manual account selection | Same explicit-selector precedence, but most recent sign-in in the current terminal. Pinned help `out/op-oracle/captures/account__add.stdout:18`; [manual guide](https://www.1password.dev/cli/sign-in-manually). | Separate terminal preferences; never infer an app-wide preference from the last stored session. |
| Successful signin reuse | The [signin reference](https://www.1password.dev/cli/reference/commands/signin) documents avoiding an authentication prompt when already authenticated. | Successful reuse updates preference in the approved model. Native recency mutation on reuse is unverified; idempotent authentication does not answer it. Ordinary account access does not update this preference. |
| Expiry, signout, forgetting, no preference | Reviewed sources do not establish these preference transitions. Native initial-selection behavior remains unknown. | App expiry/signout retain preference; forgetting removes dangling preference; missing app preference requires explicit account selection even with exactly one account. This conservative provisional rule leaves manual mode's existing single-account behavior unchanged. These are package choices, not native oracle results. |
| Integration configuration | [App setup](https://www.1password.dev/cli/app-integration) documents the desktop integration setting and temporary `OP_BIOMETRIC_UNLOCK_ENABLED` override; [environment reference](https://www.1password.dev/cli/environment-variables) lists `true`/`false`. | Trusted host mode replaces native desktop-setting discovery. Strict exact-string override validation is conservative package policy; native aliases, case, empty values, and validation order remain unverified. |
| Authorization scope | [App security](https://www.1password.dev/cli/app-integration-security) requires per-account, terminal-scoped authorization with ten-minute inactivity and twelve-hour hard limits. | Global account preference does not transfer authorization; reuse must not restart the hard lifetime. |

Current public names are `OpAuthenticationContext` with optional `terminalId`
and `integration: "manual" | "app"`; `OpAppAccountSelection` with `id` and
`account`; and `OpTerminalAccount` with `id`, `account`, and `terminalId`.
Preferences reside in `resources["app default"]` (at most one) and
`resources["session default"]` (per terminal). These are package-owned shapes,
not native configuration schemas. Typed authentication hook results expose
`sessions?`, `terminalAccounts?`, and `signedInSession?`; the last field identifies
the authenticated session by ID rather than guessing from an unordered session
collection. App preference updates are derived from successful sign-in, not
arbitrary generic resource replacement.

The common `createOp` execution path resolves the environment override before
host policy, freezes the resulting authentication context, and forwards it to
nested backend requests. Exact `true` selects app, exact `false` selects manual;
absence retains trusted `authentication.integration` or defaults to manual.
Stored sessions do not infer integration mode. Direct backend callers supply
their context explicitly, without common-CLI environment parsing.

The account-selection callback wiring is verified by fresh SDK and Node
sign-in persistence/reuse checks; the earlier missing-wiring concern is
withdrawn. The app-only single-account fallback has been removed without
changing manual single-account behavior. The reported security/concurrent-update
review passes; this is not authenticated native evidence. The code-owner freeze
and final combined local checks are complete as recorded below.

Newton reports the completion worker frozen with 504 passing tests. Source
inspection confirms a shared argument-aware resolver, hidden `__complete` and
`__completeNoDesc` callbacks, and Bash/Zsh/Fish/PowerShell adapters. Bash and Zsh
runtime checks were executed; Fish and PowerShell runtimes were unavailable.
Backend-derived argument suggestions and exact vendor descriptions remain
unsupported. These updates supersede the historical completion-grammar gap
above, not the full native completion compatibility requirements. The reported
worker result is not a new independent full-package test run by this docs task.

Documentation review uses public sources, current code, and saved no-auth help
only; no sign-in, credential access, or native network operation is required or
performed for this update. No full-parity, release-readiness, local commit,
remote-main delivery, or registry-publication claim follows from this checkpoint.

### Final frozen-code local verification

Ptolemy's final maintained checks pass **506/506 tests, zero failures, zero
skips**, package ESLint/test typecheck, the maintained selected-workspace build,
and scoped diff validation (including 64 untracked scope files). Package-policy
validation reports exactly one violation: the missing `packages/op/README.md`.
That policy check is not a pass and was not waived or fixed by this docs task.

Fresh synthetic SDK and Node checks pass authorization denial, hook-issued
sign-in, account-preference persistence, reuse without another hook invocation,
and snapshot restoration without a hook. Independent completion security review
passes 22 callback cases and seven ordinary-operation cases, checking callback
backend isolation, no sensitive-input echo, and no ordinary-operation policy
bypass. Actual Bash/Zsh callback execution and the Node zero-backend screenshot
were inspected. Zsh completion was captured outside ZLE, not through interactive
Tab-key QA; Fish/PowerShell runtime checks remain unavailable.

Evidence logs: `out/op-final-verification-unit.log`,
`out/op-final-verification-lint.log`, `out/op-final-verification-build.log`,
`out/op-final-verification-diff.log`, `out/op-final-verification-policy.log`,
`out/op-final-verification-signin.log`, and
`out/op-final-verification-completion.log`. This documentation update inspected
those logs; it does not claim a separate rerun of the full checks.

Native initial account selection and preference transitions remain provisional
as classified above. Backend-derived completion arguments, exact vendor
descriptions, authenticated result schemas, and the broader inventory gaps
remain open. No README was added and no commit, verified remote-main delivery,
successful release, or full native parity is claimed.

### Latest maintained checkpoint: 594 tests and fresh pack verified

The current-tree audit now records Ptolemy's final 594/594 tests with zero skips,
package lint/test typecheck, maintained build and diff checks including 68
untracked scope files. Evidence is `out/op-final-freeze-{unit,lint,build,diff,policy,help}.log`.
Policy exits 1 for the missing README only. Bulk follow-up passes 26/26 in
`out/op-items-bulk-frozen-backend.log`; actual cross-account pipeline and derived
reference checks are in `out/op-bulk-cross-account-cli-frozen.log`. Refreshed
screenshots were inspected. Mendel's fresh `@poe-platform/op@0.0.1` pack passes
isolated ignore-scripts consumer bin/help, SDK, Node subpath, types, completion,
bulk and reference checks. Evidence: `out/op-frozen-prepack.log`,
`out/op-frozen-consumer-smoke.log`, `out/op-frozen-artifact-proof.log`.
Artifact SHA-256:
`0c5d6926778f4b3ccbed9b599662290d93ae5c51678b0b2b9f79d31ba5f7dbe7`.
Independent backend/reference review additionally reports 85 tests passing.

Resolved-identity approval binding remains a hard full-goal gap; the original
promise is not weakened to literal-request immutability. Native remapping,
serialization and other fidelity gaps remain open, separately from README
permission and delivery/release gates. See the current requirement audit for
per-requirement status; this checkpoint is not a claim of full native parity.
The [approval-binding proposal](op-approval-bindings.md) is ready but not
implemented. Missing README permission and approval identity binding block
release. No further code, README, commit, push, or publication follows from this
documentation checkpoint; a verified local pack is not a verified release.

### Binding-wave status, 2026-09-08: supported object gate verified

Latest finite typed-closure checkpoint: 835/835 tests, lint/types, selected
build, whitespace and fresh installed CLI/root/Node SDK/declarations pass;
70 saved native outcomes match. CSV binding semantics and LETTERS,+20 password
generation are verified with raw policy/prepared strings preserved. Inventory
`out/op-typed-flag-inventory.json`: 82 commands, 174 occurrences; 89 covered,
29 freeform, 56 backend/auth-dependent. Syntax coverage is not semantic parity;
the saved downstream recipe blocker is superseded by the final independent
section of `out/op-typed-closure-summary.log`. Current artifact:
`out/op-typed-closure-checkpoint/poe-platform-op-0.0.1.tgz`, independently verified
SHA-256 `3c7446b1c2e0741d2dfa3a248e9cae9776ef84d1ad25986ad95154b762e31e76`.
All 97 package fingerprints unchanged; workflow/package policy were not rerun.
External fixtures, config storage, native output, expiry/device lifecycle,
README permission and reconciliation/delivery gates remain open. No release.

Latest typed-flag checkpoint supersedes the pending notes below: 829/829 tests,
lint/types, selected build, whitespace and fresh installed CLI/root/Node SDK/
declarations pass; 88 saved native grammar outcomes replay without mismatch.
SSH case/hyphen forms reach canonical generators, raw policy flags unchanged;
uint32 modes reach injected hosts unchanged, not proven native OS semantics.
Summary `out/op-static-five-checkpoint-summary.log`; 95 fingerprints unchanged.
Archive `out/op-static-five-checkpoint/poe-platform-op-0.0.1.tgz`, independently
verified SHA-256 `b8facd60f4b1fc331a80764b0dee779a760c61597361645dcba0b321822e2e33`.
Workflow/package-policy checks were not rerun. Missing README, actual lifecycle,
config/output/native fixtures and reconciliation/delivery gates remain open;
local metadata and synthetic hook success do not prove remote enforcement.
No README edits, commits, publication or release.

Post-799 typed-flag validation is frozen: 828 unit tests and 88 native cases pass
after 21 red tests, with types/scoped lint/whitespace and inspected screenshot.
Evidence: `out/op-static-five-*.log`. Contracts: device deauthorization uses
Go-duration syntax without day/week extensions; Travel Mode exact on/off;
allow-admins Go boolean spellings; case-insensitive SSH type aliases including
hyphenated RSA sizes; file modes at least three octal digits within uint32.
RSA3072/rsa-2048 downstream generation normalization remains assigned to Peirce;
Newton's independent functional/fresh checkpoint is pending. Syntax validation
does not implement expiry/device lifecycle, account policy, config storage or
native output. Earlier deauthorization-syntax absence notes are superseded,
but the hook-required lifecycle boundary is unchanged.

Latest duration-fixed checkpoint: 799 unit tests, 17 focused regressions,
lint/types, selected build, whitespace and fresh installed CLI/root/Node SDK/
declarations pass. Both wrap signs accept, neighboring overflow controls reject,
and raw duration strings remain unchanged through hooks/policy. Summary:
`out/op-duration-fixed-checkpoint-summary.log`; 93 package fingerprints unchanged.
Archive `out/op-duration-fixed-checkpoint/poe-platform-op-0.0.1.tgz`, independently
verified SHA-256 `f674d7f559e865c0fed29ba3337555b83131e144d17af47a0d35a0018f87d022`.
This supersedes the pending duration artifact notes below. Workflow/package-policy
checks were not repeated; previous workflow lint is historical only. Missing
README, actual expiry/device-deauthorization lifecycle, native fixture/config
decisions and full-goal reconciliation/release gates remain open. No release.

Post-782 duration syntax work is frozen: 796 unit tests, types/scoped lint/
whitespace and 176 bounded native comparisons pass after nine red cases.
`--expires-in` on item share, Events API create, service-account create and
Connect token create uses shared Go-style validation with native day/week
preprocessing; raw strings, omission and binding inputs stay unchanged.
Evidence: `out/op-duration-parser-*.log`, `out/op-duration-rounding-crosspath.log`.
Newton's independent functional/fresh artifact checkpoint remains pending.
These commands still require hooks; no expiry lifecycle is proved. Delayed
`user suspend --deauthorize-devices-after` remains hook-required and is not
covered by this new syntax validator. No universal native-equivalence claim.

Subsequent wrap correction supersedes that assessment: native acceptance of two
consecutive `9223372036854775808ns` components is now matched using unsigned
accumulation without dropping per-component/intermediate overflow checks.
Ptolemy's frozen fix passes 799 unit tests, 17 targeted tests and 195 native
comparisons with zero mismatches, covering both signs and rejection controls.
Evidence: `out/op-duration-wrap-*.log`. Newton's final checks/repack are pending;
no universal duration equivalence or lifecycle enforcement is claimed.

Latest corrected-role checkpoint: 782/782 tests, lint/types, selected build,
whitespace and fresh installed SDK/Node/CLI/types pass. Uppercase MEMBER/MANAGER
execute with lowercase stored/output roles, no whitespace trimming and unchanged
raw policy/caller inputs. Invalid values fail before input/backend. The earlier
installed failure is resolved, not waived. Summary:
`out/op-role-fixed-checkpoint-summary.log`; artifact
`out/op-role-fixed-checkpoint/poe-platform-op-0.0.1.tgz`, independently verified SHA-256
`b11a95a65a6123ad3cb55089ec16b065772a83c4e12f4e30ba69fb7c11d4e700`.
All 90 package fingerprints are unchanged. Workflow/package-policy routes were
not rerun; prior missing-README failure remains open. Duration grammar, native
fixtures, config storage decisions and delivery/reconciliation gates are not
closed by this local checkpoint. No commit, push or release.

Latest checkpoint supersedes the pending notes below: 778/778 tests, package
lint/types, selected build, workflow lint and fresh installed CLI/root/Node
SDK/types pass. Installed plugin-list human/JSON match pinned native captures;
screenshot inspected. `out/op-release-checkpoint-summary.log` records 89 unchanged
package fingerprints and an initial test-only EOF whitespace failure. Planck
subsequently corrected it; whitespace now passes with production artifact
unchanged. Archive `out/op-release-checkpoint/poe-platform-op-0.0.1.tgz`, SHA-256
`f630326651829160b197851f1fe96ac1222e14e7790320406d63846511fab2a7`, was independently
verified. README-only policy failure, native gaps, storage decisions and
reconciliation/delivery gates remain open. No commit, push or release is implied.

Post-756 source addition: built-in plugin availability now matches the pinned
no-auth `out/op-oracle/plugin-availability-toNiXs/probe-0.json`: 90 rows,
89 executables and one `rediscloud` registry-only row. Independent structured
comparison confirms row content/order. Availability is separate from account
configuration; custom scoped metadata is supported, while unconfigured inspection
fails explicitly rather than imitating native interactive IO. Newton's ordinary
verification/new checkpoint remain pending. Ptolemy's permission parser is frozen:
125 scoped tests and 163 native comparisons pass, with lint/types/whitespace.
The last full run reported 769 passing and two plugin-selection failures;
Newton subsequently corrected stale expectations red/green and reports 27
independent scoped checks passing. No replacement full green checkpoint is claimed.
Planck reports byte-identical human and 90-row JSON captures; the dedicated
human renderer is frozen and its native-column screenshot was inspected without
clipping. Updated Node tests pass 117/117 plus lint/types; final maintained
checks are running. `pluginRequiredFieldLabels` is display-only native
metadata, not credential schemas; JSON remains unchanged.
The 756-test archive below does not certify this subsequent addition.

Final combined checkpoint supersedes the 718-test evidence below: 756/756 tests,
package lint/types, selected build, workflow lint, whitespace and fresh installed
CLI/root/Node SDK/declarations pass, including plugin selection/approval.
All 82 package fingerprints remain unchanged. See
`out/op-combined-checkpoint-summary.log`; current archive is
`out/op-combined-checkpoint/poe-platform-op-0.0.1.tgz`, SHA-256
`8b484dbe025238c890ab1a5a3dfb4ddf2284b2599995b4ffb25bd225dd6f8ec2`.
README-only policy failure remains, with permission unanswered. Native fixtures,
config storage decisions, remaining local semantics and full native parity are
not closed by this checkpoint. Latest delivery relay reports remote main 410
commits ahead, with no package/workflow delivered or staging; see the current
audit for exact SHAs. No reconciliation, commit or release is claimed.

Latest functional checkpoint: 718/718 maintained unit tests, lint/types, build,
workflow lint, whitespace and fresh installed CLI/root SDK/Node SDK/declarations
pass. `out/op-final-checkpoint-summary.log` records synthetic timestamp-env,
ordered batch/rollback and overwrite checks, inspected screenshots and 78
unchanged source/config/license fingerprints. Current archive:
`out/op-final-checkpoint/poe-platform-op-0.0.1.tgz`, SHA-256
`7957abfd576803e84cceffb606d48edc73e1aa6fe4557609541f26634e9d39f6`.
This supersedes the 684-test artifact below for current local checks, not the
native fidelity gaps. Package policy still fails only for missing README;
permission remains unanswered. No commit, delivery or release is claimed.
The [safe fixture guide](op-native-fixtures.md) exists for an independently
supplied blank-template/synthetic-output bundle; no response or receipt is inferred.

The concrete common CLI/SDK API now adds `approvalMode`, `authorizeResolution`
and `approveResolved`; the default resolved `ask` path requires backend
`prepareBinding`, `validateBinding`, `cancelBinding` and prepared handlers.
Direct `allow` is unchanged; only explicit literal mode uses legacy `approve`,
without satisfying or weakening the resolved-identity promise. See the current
audit and `docs/op.md` for actual field names and capability boundaries.

The final maintained checkpoint passes 684/684 package tests with zero skips,
lint/test typecheck, build and whitespace checks, superseding migration-era
failures. Fresh installed consumer SDK/Node CLI/types and original
rename-during-approval regressions pass. Installed SDK, Node CLI and executable
reject reassignment with exit 1, zero operation output and no stale execution.
Approve/deny screenshots were independently inspected. See the
[frozen evidence ledger](op-resolved-approval-verification.md#frozen-checkpoint-results)
for named logs and archive SHA-256
`8c0f2aaf1a374094ba0322dc5b59ce838992c84cc92d754e6b324a06226bc245`.
Ptolemy's subsequent independent verification passes 33/33 scoped tests plus
typecheck/lint, closing synchronous preparation and malformed metadata getter
error leaks and the queued-invalidation/stdout handoff defect. Actual bound
authentication context and synchronous validation/handoff ordering are covered.
The resolved-identity invariant remains required and is verified for the supported
cooperative object backend, closing audit A6 and A12–A14 within that scope.
`out/op-resolved-final-node-validation-wiring.log` verifies the Node wrapper's
synchronous cached-backend validation in source and artifact, without an added
await or reload. This is not arbitrary-adapter, native-parity or release proof.
File-backed Node resolved approval fails closed: no cross-process persistent
revision guarantee exists. Host effects remain host-owned; no OS identity or
distributed atomicity guarantee is introduced. Coarse generation invalidation
is provisional conservative abort behavior, not exact native conflict policy.

An independent Mendel review attempt ended with a terminal policy error and did
not complete. It is neither credited nor restarted; Ptolemy's ordinary independent
boundary verification is complete and distinct. The current artifact supersedes
the previous 594-test pack for supported object binding. Full native parity and
release remain unclaimed; file-backed resolved support, README permission and
remaining compatibility/delivery gates stay open. No commits or release occurred.
