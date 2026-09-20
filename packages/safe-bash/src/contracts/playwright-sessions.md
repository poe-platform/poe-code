# Playwright sessions and host capabilities

`createPlaywrightCli` implements the `@playwright/cli@0.1.20` command surface.
The injected adapter owns browser allocation; commands and their help use the
standard syntax. Standard `-s`, `--session`, and `PLAYWRIGHT_CLI_SESSION` values
select an alias, not a provider session or a tenant identity.

`playwright-cli --help`, `playwright-cli attach --help`, and JSON help report
whether an authenticated attachment broker is configured. Without one, attach
is unsupported: after a provider failure, do not retry attach. Use
`playwright-cli list` to discover owned aliases, then explicitly select an existing
alias with `playwright-cli -s=<existing-alias> snapshot`, `tab-list`, or `goto <url>`.
Listing saved profiles does not verify live connectivity; an explicitly selected
command may still fail while the provider is unavailable. Hosts supplying an
authenticated `attach` ability retain their attachment command.

The host must isolate each controller and its persistence callbacks by trusted
owner identity. Never use an untrusted alias to select another owner's browser,
filesystem, or storage namespace. Browser networking follows the selected native
provider and explicit caller configuration. Any application-specific network
policy must come from that host's documented requirements, not from the presence
of arbitrary browser JavaScript or an isolated code runner.

Private CDP target/session capacity counts active identities. Only native target
destruction or session detach confirmations release that identity's capacity.
Bounded recent retirement tombstones suppress late messages; active private
identities never age out or get evicted to admit another target/session.

The trusted control supplied to `createPlaywrightStorageOriginPreparer` must
report whole-control disconnection as `Inspector.detached` without `sessionId`,
including when its socket reaches EOF. This rejects loading and pending private
target retirement with `Native storage control disconnected`, removes control
and abort subscriptions, and blocks new native lease work. It does not
confirm target destruction or release private target capacity. Session-scoped
`Inspector.detached` is not whole-control loss; during expected target closure,
retirement still joins the owned `Target.targetDestroyed` confirmation. Hosts
must settle outstanding control requests; disconnect notification does not
preempt an opaque, uncooperative `send` promise.

Bound storage contexts enumerate IndexedDB through the owned reader, which
closes its database connections. They retain visited frame origins after tabs
close and seed origins from initial storage state. Public
`readPlaywrightStorageState` uses this route with `PlaywrightStorageOperationOptions`;
restoration clears IndexedDB through the verified same-context native target,
including connections held by provider census or application code. Native
blocked database requests fail explicitly without reloading live tabs.

Browser-realm read and restore expressions use generated string literals from
the typed functions in `native-storage-realm.ts`. Consumer naming preservation
or minification must not introduce bundle-scope dependencies into these strings.
After changing either canonical function, run
`node scripts/generate-native-storage-sources.mjs` from the package directory;
the guarded package build rejects missing or stale literals before emission.

## Native browser adapter

`createPlaywrightAdapter` accepts native browser capabilities. It forwards
validated context options, uses native page and locator methods, observes
browser events, and retires resources on cancellation or a failed lease.
Canonical device descriptors are bundled; injected descriptors override them.

Acquired resources may expose these additional trusted host operations:

- `captureArtifact` reads a generated native file into bounded bytes. The host
  supplies the temporary path and cleans it up after success or failure.
- `captureDownload` retrieves the original native download bytes. A remote
  provider must supply a real transport; replaying the source URL is not an
  equivalent download.
- `captureTrace` flushes and reads the current recording's native trace,
  network, and referenced resource files. Returned paths are relative and
  validated before the CLI writes standard live trace files into its VFS.
- `prepareFileBytes` supplies the provider's binary input representation.
- `generateActionCode` renders validated native actions with the provider's
  Playwright language generators, using the selected standard codegen language.
- `captureSnapshotJSON` returns the native accessibility tree with its actionable
  refs. The host bounds frames and serialized bytes before transport and honors
  cancellation; a failed capture retires the lease before another command.
- `executeCode` runs a standard Playwright function with the selected native
  Page. The host must isolate arbitrary JavaScript from its own process,
  credentials, bindings, and other owners. Source and output bounds, browser
  creation limits, cancellation, and late-side-effect revocation remain host
  responsibilities. A caller timeout alone does not terminate guest code.
  `limits.codeExecutionTimeoutMs` bounds startup plus execution independently of
  configured native action/navigation timeouts; its default is 30 seconds.

Resource operations participate in lease cleanup. Hosts should use idempotent
provider retirement, including a separate interrupt path for stalled browser
protocol work. `PlaywrightResourceLimitError` tells the controller that the
operation exceeded an ownership or resource boundary and requires retirement.
Ordinary command errors preserve a healthy session.

## Persistence

Optional persistence callbacks operate within the host's trusted owner scope:

- `checkpoint` receives the current context, selected page, validated context
  settings, effective configuration, and idle/expiry metadata. It commits
  atomically after a complete read and returns `void` or `{ status: 'committed' }`.
  A trusted reader may throw `PlaywrightStorageReadError`, or return
  `{ status: 'storage-read-failed', error }`, only after confirmed owned-target
  destruction with healthy control. Cancellation, uncertain ownership,
  disconnection, and failed cleanup remain fatal. The native origin preparer
  bounds load and retirement waits (10 seconds by default).
- `restore` returns a newly owned lease and selected page. Its optional
  `initialize` callback runs after controller observers attach and startup
  scripts are registered, before the restored session is published.
- `list` returns bounded metadata for resumable saved sessions without opening
  browsers. The host excludes deleted, intentionally closed, or expired data.
  CLI listing reports persisted profiles as `saved` and retained live sessions
  as `open`, in both standard text and JSON output. `saved` does not establish
  browser connectivity or successful restoration. A later browser command may
  attempt restoration and fail if the provider is unavailable. Diagnose that
  failure before retrying; listing never restores, navigates, or consumes a
  one-time URL. Explicitly closed sessions remain absent until explicitly opened.
- `close` suppresses automatic restoration without requiring storage deletion.
  An undefined name closes all saved aliases for that owner.
- `delete` removes the named profile and its operation receipt before returning
  successfully. Once deletion succeeds, the controller forgets its local receipt
  and sends no terminal `recordOperation` callback, even if later output or
  cleanup fails. Failed deletion still records `unknown`.

Host-only `inspectRecovery({ name, signal? })` returns `live-page`,
`saved-storage`, or `unavailable`, with `livePageStateLost` and optional
`operation: { operationId, status }`. It reads the optional persistence
`inspectRecovery` callback's `{ hasStorage, operation? }` metadata without calling
`restore`, acquiring a browser, navigating, submitting forms, or executing code.
It copies only validated correlation fields; URLs, cookies, provider objects,
and exception messages are absent. `unavailable` means no retained page or
confirmed saved storage, not proof that an interrupted effect did not happen.

Hosts can import `parsePlaywrightOperationOutcome` and
`validatePlaywrightSessionName` from `@poe-platform/safe-bash/playwright`
to validate durable receipts and aliases. The parser returns a frozen copy of
only `operationId` and `status`; identifiers use 1–128 ASCII letters, digits,
underscores or hyphens. URLs, scripts and credentials are excluded.

The optional `recordOperation({ name, operation }, signal)` callback must durably
commit `running` before returning. It runs before session-command effects,
including automatic restoration. Hosts may provide an opaque `operationId` on
SDK invocations; otherwise a UUID is generated when recording is enabled.
Successful commands record `completed`; errors and cancellation record `unknown`.
Successful `delete-data` retires its running receipt instead. Terminal updates
must atomically match an existing receipt's `operationId`: ignore them if the
receipt was deleted or replaced by a newer running admission. Never upsert a
terminal update. This check belongs to the host's durable store, since separate
controllers can share an alias and local serialization cannot order their writes.
A process killed during an effect can leave `running`; inspection reports it as
`unknown` when no page is retained. These records are correlation, not an exactly-once protocol:
the host must reserve effects and refuse automatic replay of uncertain work.

For interrupted-owner recovery, call `restoreBrowserProfile` with
`recovery: true`. It imports saved storage into a new context and creates one
blank page, omitting saved navigation, configuration modules, and provider runtime
scripts. Adopt its result through `restoreSession`; the returned
`recovery: 'saved-storage'` marker suppresses initializers and keeps loss of the
original live page explicit in subsequent inspection. The host can also supply
that marker directly on `restoreSession`. This does not reattach the original
provider session or restore its DOM, JavaScript heap, or outstanding operation.
Ordinary profile restoration defaults to `tabRestoration: 'blank'`: it restores
storage, configuration, provider settings, tab count, and selection without
navigating saved URLs. Hosts may explicitly authorize `tabRestoration: 'navigate'`
to replay saved URLs, which can repeat consumed login links or other actions.
Select inert recovery after interruption when configuration and provider scripts
must also be suppressed. Both profile restoration modes return
`livePageStateLost: true`, so adopting a reconstructed profile cannot imply that
the original live page survived. Recovery metadata has no guest CLI command.

After a recoverable checkpoint failure, the completed action and live session
remain usable. The SDK throws `PlaywrightCheckpointError` with
`actionCompleted: true` and `profileCommitted: false`. The CLI keeps the completed
result on stdout, reports persistence failure on stderr, and exits 1. Retry
persistence with a later command; do not replay the completed action. The last
committed profile stays unchanged. Cold restore resumes that older committed
state; it cannot recover changes from the failed checkpoint. Hosts must not mark
the old profile as newly saved. Explicit close, disposal, cancellation, and
expiration still retire the live session.

The controller checkpoints before graceful disposal. Explicit close is
distinct from disposal: later explicit open may reuse saved storage, while
ordinary commands must not silently reopen an intentionally closed session.
Forceful cleanup must not wait on a new checkpoint.

Use `parsePlaywrightStorageState`, `parsePlaywrightContextOptions`, and
`parsePlaywrightSessionConfiguration` when accepting persisted data. A host
must additionally bound and validate its own envelope, navigation URLs,
retention policy, and storage publication. Playwright storage state does not
include arbitrary DOM/JavaScript heap state or sessionStorage. Automatic host
checkpoints may include IndexedDB; standard explicit state commands retain
the upstream behavior.
