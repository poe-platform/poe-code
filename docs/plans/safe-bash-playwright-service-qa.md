# Safe-bash Playwright public integration and service QA

## Acceptance boundary

Execute this markdown plan manually through public built imports. Unit doubles
and declaration compilation validate local contracts, never service acceptance.
Record each case as passed with observed evidence, failed, or unverified with a
specific missing prerequisite. Do not run charges or add reporting/metering code.
Concurrency billing is deferred. Do not change README, commit, push or publish.

## Profiles and owner record

- Pin `playwright` and `playwright-core` to 1.58.2, `@cloudflare/playwright` to
  1.3.6, TypeScript to 5.9.3 and Node types to 22.20.1 using the maintained
  `playwright-qualification.package.json.fixture`. Record actual resolved
  versions, Node version, OS, executable and browser version. Local Chrome is
  an explicitly selected oracle; it is not Playwright's bundled Chromium.
- For Cloudflare, record deployed Worker name/version, account identifier
  (redacted), Wrangler version, `compatibility_date`, complete
  `compatibility_flags`, browser binding name, `keep_alive`, service idle/max
  lifetime and quota policy. Require a real `BrowserWorker` binding supplied by
  the host, not an ambient token, invented endpoint or mock. Confirm required
  compatibility settings against the pinned package and deployed manifest.
  An absent manifest/binding means those settings are unknown, not defaults.
- The pinned Cloudflare package's published configuration requires
  `nodejs_compat` and an explicit `browser = { binding = "MYBROWSER" }`.
  Its documented standard-CDP path begins at compatibility date 2026-03-17;
  a prior date or `no_websocket_standard_binary_type` selects the documented
  fallback. Qualify the actual chosen path; do not silently mix profiles.
  A proposed QA Worker profile is `compatibility_date = "2026-09-16"`,
  `compatibility_flags = ["nodejs_compat"]`, and that explicit browser binding.
  This is a provisioning prerequisite, not a deployed or accepted configuration.
  The signature fixture requests `keep_alive: 60_000`; the pinned declaration
  allows 10,000–600,000 ms and documents 60,000 ms default. No remote session
  was created here and no actual idle policy was observed.
- Record who owns each browser, connection, context and controller. An owned
  regular browser release closes it; a borrowed release returns/detaches only
  the owned connection and must preserve the remote browser and sibling leases.
  Qualify Cloudflare launch and reconnect separately; do not infer termination
  from `Browser.close`, disconnect or context closure. Obtain provider lifecycle
  observations and reconcile partial launch failure before claiming termination.
- Record controller creation, lease transfer after output, context retirement,
  host release, disposal completion and remote end confirmation separately.
  Scope a stateless Worker controller to one execution. Named sessions persist
  only within that owner; cross-request/eviction persistence needs an explicitly
  provisioned durable owner and separate evidence. Close admission at shutdown,
  await disposal and use host lifecycle access to reconcile orphan resources.

## Maintained routes

1. Run `npm run build:workspaces -- --workspace=virtual-bash`. This selects the
   declared workspace dependency closure and guarded builds, without caching.
2. Run `npm run test:unit --workspace=@poe-code/safe-playwright` and
   `npm run typecheck --workspace=@poe-code/safe-playwright`.
3. Run `node --import tsx --test
   packages/safe-bash/tests/plugins/playwright-adapter.test.ts
   packages/safe-bash/tests/plugins/playwright-cli.test.ts`. These are
   service-free exact plugin tests, not the full safe-bash unit gate.
4. Run `npm run typecheck --workspace=virtual-bash` for built source/tests and
   maintained public consumer groups, including the registered billing consumer
   and expected-error controls. Run `npm run test:runner --workspace=virtual-bash`
   for guarded runner/input membership checks and `npm run lint:eslint`.
5. Copy the maintained qualification package/tsconfig fixtures into isolated
   evidence storage, install exactly the pins with browser download disabled,
   bind `poe-code` to this built checkout, and copy
   `playwright-compatibility.ts.fixture` as `consumer.ts`. Compile with the pinned
   compiler. The fixture must import public `poe-code/safe-playwright/adapter`,
   `poe-code/safe-playwright` and CLI exports, not source files. Keep the concrete
   type and Buffer negative controls. `skipLibCheck` accommodates upstream
   ambient declarations; it does not waive consumed-type checking or prove
   Worker deployment compatibility.

## Execute against each available real profile

Use `Shell` and `MemoryFileSystem` from `poe-code/safe-bash` and
`createPlaywrightCli` from its public command export. Install `agentCommands`
and the explicit plugin. Trusted QA setup may prepare deterministic DOM content;
guest commands may not execute browser code or use host paths.

| Case | Actions and required observations |
| --- | --- |
| Unsupported options without effects | Try unconfigured engine/headed mode, `run-code`, `pdf`, `snapshot --depth=3`, `screenshot --quality=90`, bad ref and invalid session. Count acquisition, context/page creation, navigation, releases and VFS entries before/after. Parser rejection changes none. |
| Ref identity and staleness | Create identical buttons, quoted input and iframe. Snapshot, click the second button, fill the input and click the frame button. Inspect DOM and screenshot. Replace a referenced node; old ref fails without targeting its replacement. Navigation, new snapshot, tab selection/external tabs, close/reopen and generation replacement invalidate old refs. |
| Canonical artifacts | Save snapshot and PNG via `--filename` and shell redirects/pipelines. Read bytes from the same canonical VFS; PNG stdout and file bytes match. Check no guest filename is passed to browser screenshot APIs and no corresponding host artifact exists. Evidence export is a separate trusted QA operation. Validate failed/limited output does not publish partial artifacts or transfer a new lease. |
| Named sessions and tabs | Verify explicit `-s` overrides exported `PLAYWRIGHT_CLI_SESSION`, local unexported value does not select, and names are identifiers. Keep two independent sessions, create/list/select/close tabs, close last tab then create again. Session/tab limits reject allocation before effects and include acquiring/retiring capacity. |
| Owned and borrowed release | Close owned session, await context-before-host release and confirm end externally. Borrow a browser for two leases; retire one and prove sibling use and remote browser survival. Repeat disposal/release and overlapping calls; one shared completion and no repeated release. |
| Late acquisition and cancellation | Delay trusted acquisition before returning a real resource; abort while waiting, then settle it and confirm late cleanup. Repeat delayed context creation, late rejection, active navigation cancellation, queued cancellation and abort after successful publication. Queued/old command cancellation preserves unrelated retained leases. Observe late rejections; never claim arbitrary preemption or undone navigation. |
| Expiry and quota loss | With lifecycle access, allow real configured idle expiry without keep-alives, then force/observe actual service quota refusal and loss. Existing refs/pages fail, loss is visible, explicit reopen is required and no action is replayed. Confirm remote end separately. Distinguish preallocation refusal from unknown partial acquisition. Do not exhaust unrelated production quota. |
| Replacement races | Delay old close, queue reopen, trigger old-generation disconnect/close notification after replacement. Old events cannot retire replacement, old refs cannot act on it, retirement capacity stays reserved and explicit actions are not replayed. Test independent session concurrency separately from deferred concurrency billing. |
| Disposal and owner lifecycle | Dispose during acquisition/action and after successful commands; close admission synchronously, drain admitted work, retire late resources and share settlement. Verify cleanup failures preserve original causes. Check actual Worker execution/eviction/durable-owner behavior only with deployed lifecycle access. |

Inspect actual browser PNGs and ad hoc terminal screenshots of successful refs,
stale diagnostics, session/tab listings and unsupported-option errors using the
maintained `npm run screenshot -- <command>` renderer. CLI rendering here is
injected shell output, not a new top-level poe-code command. No screenshot tests.

## Billing declaration review only

Review both exported contracts and the strict public consumer; execute no hooks
against a billing service. Required declarations permit a caller-selected positive
interval, awaited preallocation authorization and serialized cumulative reporting
through acquisition `usage`. Identity survives reconnects; idle contributes to
duration; final confirmed end includes the last partial interval. Stable event IDs
deduplicate retries; revisions permit correction, including downward adjustment.
`unknown` carries no fabricated zero/end. `ended` does not charge the final total
twice. Hook rejection requires stopping affected use, draining reporting and
awaiting owned cleanup with both failures preserved; borrowed browsers survive.
Accounting can require reconciliation after disposal or partial acquisition.
Types cannot enforce cadence, valid numeric/time values, deduplication, cleanup
or service end; these remain injectable-host obligations, not runtime passes.
The ordinary adapter lacks `liveBrowserUsage`; SDK and CLI reject billing.

## Evidence and execution record

Keep planning and the durable result summary here. Temporary dependencies, logs,
scripts and PNGs belong under `/out`, then purge only this task's artifacts after
inspection. On this host `mkdir -p /out/safe-bash-playwright-validation` fails
with `Read-only file system`; record this constraint explicitly. Use checkout
`out/safe-bash-playwright-validation` as the existing host workaround, then purge
it. No generated QA script becomes a maintained QA route.

## Results on 2026-09-16

- Actual resolved pins: regular Playwright and playwright-core 1.58.2,
  Cloudflare Playwright 1.3.6, TypeScript 5.9.3, Node types 22.20.1.
  Host: Node v22.22.2, macOS 15.7.7. Explicit executable:
  `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`, version
  152.0.7977.84, headless. No bundled Chromium, Firefox or WebKit run.
- Selected virtual-bash build: passed seven declared workspace builds.
  Safe-playwright maintained unit tests: 33 passed. Exact safe-bash CLI/adapter
  tests: 33 passed. Safe-playwright typecheck: passed. Safe-bash maintained
  typecheck: passed source/tests, four source-consumer groups, 26 public
  consumer groups and three expected-failure consumer controls. Runner checks:
  526 passed. These totals are scoped checks, not the full repository test gate.
- The pinned compatibility fixture now consumes public built adapter, SDK and
  CLI declarations and compiles with its concrete-type and Buffer controls.
  SDK/CLI billing negative controls compile as expected. The registered public
  billing consumer covers lifecycle facts, duplicate IDs, cumulative idle
  reports, final partial totals, downward correction, reporting capability
  refusal and prohibition on unknown facts inventing a duration. None were
  delivered to a service or used for accounting.
- Initial expanded source-consumer validation failed its authenticated peer
  closure even though compilation succeeded. New SDK/CLI imports were moved
  to the pinned public qualification fixture; the registered source consumer
  uses its existing authenticated contract export. The final maintained route
  passed without changing or weakening admission guards.
- Actual Shell plus public CLI/adapter with regular Chrome: six unsupported
  options/commands/session inputs rejected before any acquisition; two named
  sessions opened; second identical button and iframe button clicked correctly;
  quoted input retained; replaced-node and navigation-stale refs rejected;
  tab new/list/select/close and independent session use passed.
- Canonical `MemoryFileSystem` held snapshot, guest PNG and redirected PNG.
  PNG signature and binary pipeline equality checked; both screenshot calls
  received no host `path`. No corresponding host `guest.png` or `snapshot.txt`
  existed. Only trusted QA exported the VFS image for inspection.
- Inspected browser screenshot: first button remains Same, second reads Clicked
  second, input reads `hello "quoted" world`, iframe reads Frame clicked.
  Inspected maintained terminal-renderer screenshot of actual Shell output:
  unsupported diagnostics/status 1, distinct refs, successful actions, stale-ref
  snapshot-again guidance, selected tab and named-session rows were legible.
- Session owner was one CLI/controller for one Shell QA lifetime. Two owned
  browsers each retired its context before its captured host release; closing
  alpha left beta connected and navigable. Repeated owner disposal shared
  completion; both browsers closed, two acquisitions and two releases observed.
  Trusted QA setup initially omitted session export across independent exec
  calls and captured a mutable browser variable in a release hook. Those QA
  mistakes were corrected before accepting this run; no product fix was made.
- Additional real Chrome ownership checks: two isolated leases on a borrowed
  browser, repeated release of one, sibling navigation after that release,
  both contexts retired and parent browser still connected. Trusted owner then
  explicitly closed the parent. Real resources returned after cancellation
  were released once without context publication. Disposal during delayed
  acquisition closed admission, drained its late owned browser and shared one
  completion. All QA-owned browsers were closed in final cleanup.
- Billing contract review: caller-selected cadence, cumulative idle/final
  reporting, event/revision deduplication and correction, unresolved-lifetime
  reconciliation and hook-rejection owned cleanup are expressible and documented.
  Finite values, clocks, periodic delivery, durable deduplication, hook-error
  cleanup and provider end confirmation remain runtime host obligations.
  No hooks, charges, timers, metering, keep-alives or accounting implementation
  were added or executed. Concurrency billing remains deferred.

## Specific unverified cases

| Profile/case | Missing prerequisite and honest status |
| --- | --- |
| Cloudflare public browser operations and artifacts | No deployed Worker manifest, explicitly injected BrowserWorker, account credentials or binding were available. Launch/connect, refs, screenshots, named sessions and tabs were not executed against that service. Types only passed. Actual compatibility date/flags, Worker deployment/version and idle settings are unknown. |
| Cloudflare idle expiry and quota refusal/loss | No service session or approved quota/lifecycle control. Actual expiry, preallocation quota refusal, loss of an allocated session and no-replay behavior under those service events remain unverified. Unit loss notifications are not service acceptance. |
| Cloudflare owned/borrowed release and partial launch | No sessions/history/end evidence or remote owner access. Termination, detach survival, sibling survival, late acquisition, partial-launch orphan reconciliation and cancellation of remote work remain unverified. |
| Cloudflare replacement and disposal | No deployed execution or durable session owner. Old-generation service races, disposal completion versus remote end, Worker eviction/shutdown and cross-request owner lifecycle remain unverified. |
| Regular remote/browser variants | No configured regular Playwright server/CDP owner, Firefox or WebKit oracle. Remote connection release/version negotiation and these engines remain unverified. |
| Remaining real lifecycle adversaries | Late context-creation failure, service expiry/quota, active/queued cancellation under real remote loss, old-generation replacement notifications and combined real cleanup failures were not induced against a real service. Maintained deterministic tests passed their local contracts only. |
| Billing delivery/cleanup execution | Declarations and contract review only by design. Real periodic idle/final reporting, hook rejection, deduplication/correction and post-disposal reconciliation were not executed and are not claimed as implemented or accepted. |

- Guarded root `npm run lint:eslint`: exit 0, complete, zero errors and two
  warnings outside this change; all 15,531 configured subjects linted.
  `git diff --check`: passed.
- Purged this task's temporary dependencies, scripts, transcripts and both
  inspected PNGs from checkout `out/safe-bash-playwright-validation` and verified
  that directory no longer exists. Absolute `/out` remained unavailable.
- No README edits, billing/metering implementation, commits, pushes or releases.
  Pre-existing workspace changes were preserved.

## Additional user edge-case run on 2026-09-16

- Reproduced a borrowed-lease cleanup defect with a failing focused SDK test:
  after context-close rejection and host return, browser/context subscriptions
  remained attached. Fixed local release to retire those subscriptions and
  notify local lease invalidation, preserving the original rejection/shared
  promise. Updated public contract and integration expectations: local
  `onClosed` is never evidence of successful remote cleanup or termination.
  The failure injection is deterministic contract evidence, not service evidence.
- Reran built public Shell/CLI/adapter against Playwright/playwright-core 1.58.2
  and explicitly selected headless Chrome 152.0.7977.84 on macOS 15.7.7,
  Node v22.22.2. Qualification compiler pins resolved to TypeScript 5.9.3,
  Node types 22.20.1 and Cloudflare Playwright 1.3.6; mixed public consumer
  compilation passed with maintained negative controls.
- Eight invalid engine/mode/command/option/session combinations caused zero
  acquisitions. Local unexported session used default; exported beta and explicit
  default selected independent leases. Two-session and two-tab capacity refused
  extra allocation. Snapshot selected the second identical button, quoted input
  and iframe correctly. Replaced-node refs and tab-selection refs failed stale.
  Closing the last tab then creating another worked. Snapshot and PNG stayed in
  canonical MemoryFileSystem; PNG signature checked and no host guest.png existed.
- Inspected the actual trusted VFS PNG export: first button Same, second button
  Second clicked, quoted input intact, iframe Frame clicked. Inspected maintained
  terminal-renderer PNG of actual Shell transcript: unsupported/stale diagnostics,
  capacity errors, tab rows and session rows were legible. QA exports are host
  evidence, not guest browser paths.
- Owner: one Shell/controller, two isolated borrowed contexts on one host-owned
  browser. Context retirement preceded each host return; closing default kept
  beta navigable. Disposal removed both contexts and returned both leases once;
  parent browser survived until trusted QA explicitly closed it.
- Additional real-resource lifecycle probes through public SDK/adapter: delayed
  real context return after cancellation was drained, original cancellation
  preserved, one host return, zero remaining contexts, parent survival. Active
  real navigation held by a trusted route was cancelled by retiring its context;
  queued cancellation did not prematurely close the predecessor. Both operations
  settled with their respective cancellation causes, no action replay occurred,
  subsequent navigation required explicit reopen, repeated disposal shared its
  promise. These are local-browser results with controlled host gates, not
  Cloudflare transport/quota/expiry acceptance.
- QA setup failures were an incorrectly quoted iframe srcdoc, missing frame-load
  wait, and assuming an export persisted across separate Shell.exec calls. Fixed
  trusted QA setup and reran successfully; none motivated product changes.
- Maintained checks passed: seven selected workspace builds, 34 SDK unit tests,
  33 exact CLI/adapter tests after rebuilding, SDK typecheck, safe-bash source/tests
  and all maintained public consumer groups/negative controls, 526 runner checks,
  pinned mixed-library public consumer compilation and git diff --check.
- Billing review remains declarations only: interval/preallocation authorization,
  serialized cumulative idle/final duration, stable IDs/revisions/corrections,
  unknown lifetime and cleanup/reconciliation obligations remain expressible.
  No billing hooks, charges, metering or concurrency billing were executed/added.
- Cloudflare prerequisites remain absent: no deployed browser binding/manifest,
  lifecycle authority or service session. All Cloudflare operations, actual Worker
  compatibility settings, expiry/quota refusal/loss, partial-launch reconciliation,
  remote release/end, replacement races and eviction remain unverified. Proposed
  compatibility settings above remain provisioning guidance only. Regular remote
  CDP/server variants, Firefox/WebKit, actual expiry/quota events, old-generation
  service notifications and combined real cleanup failures also remain unverified.
  The local late-context and active/queued cancellation probes above supersede
  only those local subcases in the earlier remaining-adversaries row.
- Absolute /out again rejected creation as read-only. Temporary qualification
  dependencies, manual drivers, transcript and inspected PNGs used checkout
  out/safe-playwright-edge-qa pending purge below. No README edits, commits,
  pushes or publication were authorized or performed.
- Real borrowed-context cleanup probe also passed with a trusted injected close
  rejection: original cause retained, one host return, adapter-added browser and
  context subscriptions removed (upstream Playwright listeners compared against
  their baseline), local invalidation notified once. Browser and unresolved
  context remained alive, demonstrating no fabricated remote termination;
  trusted host then explicitly closed the context and browser. Initial QA assumed
  zero upstream context listeners; corrected to the pre-adapter baseline before
  accepting the rerun. This remains host-failure injection on real resources.
- Final lint: guarded root npm run lint:eslint completed with exit 0, zero errors,
  two warnings outside this change and all 15,531 configured subjects linted.
  Direct ESLint of the three edited code/test files also passed. Purged only
  this run's out/safe-playwright-edge-qa dependencies, scripts, transcript and
  inspected PNGs; verified directory absence. Final git diff --check passed.
