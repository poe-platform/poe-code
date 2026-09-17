---
$schema: https://poe-platform.github.io/poe-code/schemas/plans/pipeline.schema.json
kind: pipeline
version: 1
name: Safe-bash Playwright CLI shim
readiness: draft
teardown: false
tasks:
  - id: qualify-playwright-backends
    title: Qualify the shared API and backend differences
    prompt: >
      Investigate safe-bash's existing CommandDefinition, VirtualShellPlugin,

      byte I/O and cleanup contracts, regular Playwright, and
      @cloudflare/playwright.

      Finalize an injected adapter that declares support per browser and
      acquires

      an isolated context lease with idempotent release and closure
      notification.

      Regular acquisition uses trusted launch/connect APIs; Cloudflare uses an

      explicit browser binding with its own launch/connect ownership semantics.

      Pin versions and verify exact structural type compatibility, snapshot ref

      generation/resolution, Buffer conversions, remote quota/expiry behavior,

      partial-acquisition cleanup and Worker lifecycle ownership. Record
      evidence

      and unresolved limits honestly; shared method names do not establish
      parity.

      Provisionally target agent-oriented playwright-cli, not the different
      standard

      playwright screenshot/pdf syntax. Settle that command target before
      feature

      implementation. Do not add implicit native processes or provider branches.

      Maintain this topic's plan in docs/plans; store temporary evidence in
      /out.

      This task does not authorize billing implementation, commits or pushes.
    status:
      implement: done
      test: done
  - id: define-live-usage-billing-capability
    title: Define injectable live-duration billing hooks
    prompt: >
      Prepare public TypeScript capability declarations for injected Playwright

      billing only. Do not implement billing, timers, a provider usage
      collector,

      persistence, balances, rates or payments. Scope is live browser duration
      in

      milliseconds including idle time while open; concurrency charging is
      deferred.

      Expose optional billing with required caller-selected positive integer

      intervalMs, optional awaited beforeAcquire authorization, and awaited
      onUsage.

      Acquisition accepts a stable acquisitionId and optional usage
      configuration

      containing intervalMs and a reporting callback. Usage events distinguish

      started, cumulative usage, ended and unknown lifetime; include stable
      event,

      resource and acquisition IDs, per-resource revisions, timestamps, provider

      versus estimated accuracy, and final cumulative duration after confirmed
      end.

      Specify ongoing reporting between commands, incremental charging from
      accepted

      cumulative totals, duplicate/correction handling, final partial intervals,

      serialized/coalesced callbacks and cleanup after hook rejection. Metering

      must not send browser keep-alives or extend service lifetime. Disconnect
      is

      not proof of remote termination; unknown usage requires reconciliation.

      Bind customer identity through trusted injected host state. Keep pricing
      and

      charging entirely external. Define the adapter obligation to support this

      reporting capability when injected, without implementing it in this task.

      Prefer a focused package for feature contracts, keeping safe-bash wiring
      thin.

      Validate declarations with the maintained scoped type-consumer route. Do
      not

      add runtime billing logic or tests that merely mirror interface
      declarations.

      Do not modify README content without permission or commit/push changes.
    status:
      implement: done
      test: done
  - id: implement-playwright-session-lifecycle
    title: Implement opt-in registration and owned browser sessions
    prompt: >
      Implement the qualified injected Playwright adapter integration in a
      focused

      package, with only registration, canonical VFS and byte-stream wiring in

      safe-bash. Use TDD for code changes with fake contexts and memfs. Expose a

      controller with plugin and dispose; never auto-register browser capability

      in agentCommands. Support named sessions selected by flags, exported

      PLAYWRIGHT_CLI_SESSION, then the upstream default. Validate supported
      engine

      and options before allocation or other effects; never silently substitute.

      Implement open/goto/list/close/close-all with
      acquiring/open/closing/closed

      states, per-session serialization, capacity preflight and generation
      guards

      against late closure of replacement sessions. Register invocation cleanup

      before acquisition and transfer successful leases to controller ownership.

      Cover failed/late acquisition, cancellation, close/open races,
      disconnected

      remote resources and idempotent disposal without killing borrowed
      browsers.

      Deployment ownership must not promise cross-request sessions in a
      stateless

      Worker or silently replay actions after loss. No provider-specific
      switches,

      native CLI fallback or ambient credentials. Preserve billing declarations;

      do not implement live metering or charging yet. Use narrow maintained
      checks,

      preserve others' edits and do not modify README, commit or push without

      authorization. Keep any additional planning under docs/plans.
    status:
      implement: done
      refactor: done
      test: done
  - id: implement-playwright-actions-and-artifacts
    title: Implement agent commands with snapshots and virtual artifacts
    prompt: >
      Implement the qualified agent-oriented playwright-cli supported subset:

      snapshot, click, fill, press, screenshot and tab list/new/select/close.

      Exercise actual safe-bash shell invocation with TDD, fake injected
      contexts

      and memfs, including quoting, streams, exit statuses and middleware
      behavior.

      Use one qualified shared snapshot/ref engine for both regular and
      Cloudflare

      Playwright; never assume plain ARIA text establishes actionable e15 refs.

      Invalidate stale refs on navigation/tab/session changes and cover dynamic
      DOM,

      identical elements and frames. Guest paths resolve through canonical VFS:

      screenshot returns bytes without a native path; copy retained bytes,
      enforce

      artifact/snapshot limits and await writes. Do not assume Uint8Array
      satisfies

      every library Buffer input. No host eval of guest locator strings or
      run-code.

      Reject unavailable engines/options/features before effects and label the

      supported subset honestly. Defer PDF, video, tracing/download bridges,
      native

      profiles/dashboard/install/kill commands until separately qualified.
      Billing

      remains capability declarations only, for periodic live duration including

      idle; do not implement timers or charging. Use focused maintained
      tests/lint

      and keep CLI/SDK parity. Do not modify README, commit or push without

      authorization, and preserve unrelated edits.
    status:
      implement: done
      refactor: done
      test: done
  - id: qualify-public-integration-and-qa
    title: Validate public consumers and real-backend behavior
    prompt: >
      Validate the safe-bash Playwright CLI integration through maintained
      public

      type-consumer/build routes and a markdown QA plan against pinned regular

      Playwright and an explicitly configured Cloudflare browser binding. Record

      library versions, Worker compatibility settings and session owner
      lifecycle.

      Inspect actual screenshots and verify guest artifacts stay in canonical
      VFS.

      Cover unsupported options without effects, snapshot ref
      correctness/staleness,

      named sessions, tabs, borrowed/owned release, late acquisition,
      cancellation,

      service expiry/quota loss, replacement races and disposal. Do not claim

      service acceptance from mocks or types alone. If credentials/lifecycle
      access

      is unavailable, report the specific unverified cases rather than passing
      them.

      Billing remains declarations only: review that the injectable hooks permit

      periodic cumulative browser-duration reports including idle, final partial

      intervals, deduplication, correction and hook-rejection cleanup; do not
      run

      real charges or implement billing/metering. Concurrency billing is
      deferred.

      Run appropriate maintained scope checks and screenshot CLI-facing changes.

      Keep QA/planning under docs/plans and temporary evidence under /out,
      purging

      temporary artifacts after use. Do not modify README, commit, push or
      publish

      without authorization.
    status:
      implement: done
      test: done
finalization: completed
state: archived
---

# Safe-bash Playwright CLI shim

Status: adapter boundary implemented and locally qualified; CLI integration and
Cloudflare service acceptance remain open. Qualification date: 2026-09-16.

## Goal and command target

Expose browser automation as virtual shell commands with an injected Playwright
adapter. Support regular Playwright and Cloudflare's `@cloudflare/playwright`
without provider-specific branches in command code.

The command target is settled as
the agent-oriented `playwright-cli` (`open`, `snapshot`, `click`, `fill`, sessions).
The standard `playwright` CLI has a different command contract, including
`screenshot <url> <filename>` and `pdf <url> <filename>`. Both can use the adapter
below, but they must not be silently aliased to each other. Implement only an
explicitly labelled agent CLI subset in the later feature tasks. Do not execute
the upstream CLI daemon or claim compatibility with its native filesystem,
installation, persistent profile, dashboard, or arbitrary run-code commands.

## Qualification decision and evidence

This section supersedes the proposed adapter and abbreviated acquisition sketches
below. Those sections describe later integration/billing work, not existing public
exports. Only the first pipeline task is in the current implementation scope.

### Implemented acquisition boundary

`packages/safe-bash/src/playwright/adapter.ts` defines `PlaywrightAdapter`,
`PlaywrightLease`, the consumed structural browser/context/page/locator subset,
and `createPlaywrightAdapter(sources)`. It is currently an internal module,
compiled by the selected workspace build; no public package export or virtual
CLI registration is claimed. Keep the eventual feature implementation in a
focused package with safe-bash registration/VFS/stream wiring only. This adapter
can be moved there when that package and its README are authorized.

Sources form an injected engine map. Each entry declares headed support and a
trusted `acquireBrowser(options)` callback returning `{ browser, release }`.
The factory captures declarations/callbacks at construction, rejects absent
engines and unsupported headed requests before calling the host, and always
calls `browser.newContext()` for an isolated context. There is no provider
identifier, provider branch, implicit library import, credential discovery,
native process fallback, or billing implementation.

The host callback decides resource ownership. A regular launched browser uses
`browser.close()` to terminate its owned browser. A regular
`BrowserType.connect()` handle uses `browser.close()` to disconnect the owned
client connection; the external browser is not owned. A borrowed browser source
returns a release function that relinquishes only its actual resource ownership,
possibly a pool reservation; the adapter never calls `browser.close()` itself.
Connected sources may claim only the configured engine/options actually provided
by that server. They must reject headless/headed mismatch rather than ignore it.

Cloudflare uses the explicitly injected `BrowserWorker` binding and top-level
`launch(binding, options)` / `connect(binding, { sessionId })`, not
`chromium.launch/connect`. Host binding, session ID, keep-alive, and guardrails
are trusted configuration; guest commands cannot select an ambient binding or
override an existing session's policy. Source inspection establishes that
Cloudflare launch replaces its server-side browser-process close hook with a
CDP `Browser.close` message. Connect retains the CDP transport close hook. Thus
launch close requests termination, whereas connect close detaches; neither a
WebSocket close nor a resolved transport cleanup proves the remote process ended.
Actual Cloudflare close semantics still require service QA.

Release closes the owned context before calling the host release function,
attempts both cleanup stages on failure, and returns the same promise (including
the same rejection) to overlapping/repeated callers. Acquisition plus cleanup
failure retains both errors in `AggregateError`. Browser-disconnected and
context-close events invalidate the lease once, remove both event listeners,
and notify registered subscribers. A late subscriber is notified synchronously.
Unsubscribe prevents notification. Listeners must not throw. Successful context
close also confirms local closure when an event was not delivered. Failed close
does not fabricate closure; listeners remain until an actual event arrives.
Closure notification means the lease is unusable, not remote termination.

Acquisition checks cancellation before host allocation, after browser return,
and after context return. It awaits opaque acquisitions instead of racing them
against abort, so returned late resources are cleaned up before rejection.
This does not promise prompt settlement when a trusted callback never settles.
Host callbacks must clean up their own partially acquired resources before
rejecting, and must keep a returned context alive through publication. There is
no public `BrowserContext.isClosed()` in the qualified API: a context-close event
before listener installation can be missed while its browser stays connected.
That host guarantee is a real requirement, not a tested remote guarantee.

Cloudflare 1.3.6's published `lib/index.js` has a specific unresolved partial
failure: `launch()` calls `acquire()` to obtain a session, then connects the
WebSocket and creates a browser without a surrounding cleanup catch. Failure
after acquisition can leave a remote session with no returned Browser/session ID
for this adapter to retire. `connect()` can likewise fail after obtaining a
WebSocket but before returning a Browser. Do not certify these callbacks as fully
cleanup-safe from the simple fixture sketches. A production host needs a separately
qualified recovery/reconciliation mechanism (or upstream fix) for these paths;
expiry alone is not immediate release. The generic adapter cannot recover opaque
resources never returned to it. No automatic retry or action replay is added.

### Exact version and type qualification

Qualification pins are stored in
`tests/plugins/playwright-qualification.package.json.fixture` under safe-bash:

| Component | Exact version | Qualified scope |
| --- | --- | --- |
| `playwright` and `playwright-core` | `1.58.2` | Regular library API, matching Cloudflare's embedded upstream version |
| `@cloudflare/playwright` | `1.3.6` | Published types and source, not real Worker/service execution |
| `@playwright/cli` | `0.1.20` | Command target/source only; its dependency is `1.64.0-alpha-2026-09-14` |
| TypeScript | `5.9.3` | Strict consumed subset and adapter source/tests |
| `@types/node` | `22.20.1` | Concrete Buffer input/output declarations |
| `@cloudflare/workers-types` | `5.20260916.1` | Inspected ambient-type limitation only; excluded from passing subset fixture |

Published npm artifact integrity values inspected during this qualification:

```text
playwright@1.58.2: sha512-vA30H8Nvkq/cPBnNw4Q8TWz1EJyqgpuinBcHET0YVJVFldr8JDNiU9LaWAE1KqSkRYazuaBhTpB5ZzShOezQ6A==
playwright-core@1.58.2: sha512-yZkEtftgwS8CsfYo7nm0KE8jsvm6i/PTgVtB8DL726wNf6H2IMsDuxCpJj59KDaxCtSnrWan2AeDqM7JBaultg==
@cloudflare/playwright@1.3.6: sha512-pwNuh5/eUTcVVhXComAWfS9Im0mqBBVoU73dBXPv5cbUyOIuPGxd3bD2GrTgMOe6jJEK4ZHgQBYctYEwkzPH8w==
@playwright/cli@0.1.20: sha512-kEL+73IwNVFmUjGn0rmpBStZ8jju8MmmWBMXmVMesBzoZ8YW2b/Nv7aCOYLBrCbYzc7RvWZCbVj88+wOCg8yyw==
```

`tests/plugins/playwright-compatibility.ts.fixture` assigns both libraries'
actual Browser, BrowserContext, Page and Locator types to the consumed subset,
and checks trusted launch/connect callback signatures. It checks source and
built adapter declarations. It includes guards against `any` in consumed
types/acquisition results/screenshot results/Buffer, and negative tests showing
plain Uint8Array fails both libraries' Buffer upload contract. This is exact
assignability of the consumed methods, not whole-module equivalence or runtime
service acceptance. Uploads are excluded from the adapter's current subset.

The passing mixed fixture uses the stored bundler-resolution tsconfig fixture,
ES2023 + DOM, Node types only, and `skipLibCheck: true`. `buffer` is explicitly
mapped to pinned Node declarations to avoid the repository's npm `buffer`
polyfill changing the compiler's resolution. This is a documented consumer
configuration, not a universal compatibility claim. A regular-only fixture
also passed strict NodeNext with `skipLibCheck: false`.

Negative qualification outcomes must remain visible:

- Cloudflare's published `index.d.ts` re-exports extensionless `./types/types`.
  NodeNext cannot resolve its Browser/Context/Page/Locator named exports; skipping
  library checking does not make that public import compatible.
- Loading the inspected Worker ambient types together with Node types introduces
  a global `declare const Buffer: any` and declaration conflicts. Initial negative
  Buffer checks became unused, exposing a false compatibility pass. The concrete
  guards prevent accepting that environment. Worker + DOM declarations also
  conflict under full declaration checking.
- The passing subset does not fully check Cloudflare's library declarations or
  its `cloudflare:workers` env-dependent binding-key alias. No fake Worker module
  was added to establish a pass. A real deployment's generated Worker types,
  bundler, compatibility date and binding must be separately qualified.

### Snapshots and binary runtime evidence

Regular `playwright@1.58.2` was exercised on Node `22.22.2` through the injected
adapter with an explicitly selected local Google Chrome executable and trusted
launch APIs. This is Chromium evidence, not Firefox/WebKit/Cloudflare evidence.
No guest command gains an executable-path option.

The public `page.locator('body').ariaSnapshot()` returned two identical
`button "Same"` entries without refs. The private `_snapshotForAI()` returned
distinct `e3` / `e4` refs and an iframe button ref `f1e2`. Resolving `aria-ref=e3`
clicked only the first identical button. Dynamic replacement of that element and
navigation to a replacement document each made the old ref fail. Resolving the
full `f1e2` selector in its owning frame succeeded; stripping the prefix to `e2`
failed in a bounded probe. This does not establish a generic frame-routing
contract from page-level ref strings. The generated injected source in both pinned libraries
contains the `aria-ref` selector engine and ref-rendering code, but presence does
not qualify Cloudflare's private API execution. Its wrapper explicitly includes
public locator `ariaSnapshot`; private page snapshot execution was not established.

Decision: do not implement a ref-generating action layer using plain public ARIA
text, invent refs from line numbers, or export the private API as a shared public
contract. The later action task must qualify generation and resolution together
against both real backends, including dynamic DOM, identical elements and frames.
If private pinned API execution cannot be qualified for Cloudflare, choose an
explicit shared ref engine and test its element identity/lifetime semantics.
Current source presence + regular runtime evidence is insufficient to accept
that shared snapshot engine. Navigation/tab/session changes require explicit
ref invalidation regardless of incidental engine behavior.

Runtime Buffer checks used `[0, 128, 255, 10]`: `Buffer.from(bytes)` retained
the original values after the source Uint8Array was overwritten; an in-memory
file payload uploaded successfully. `new Uint8Array(screenshotBuffer)` preserved
the PNG after the original Buffer was modified. PNG header bytes were verified,
and the screenshot was inspected: only the selected button read `Clicked`, the
other identical button stayed `Same`, the uploaded filename and iframe button
were visible. Screenshot SHA-256:
`4563af2dffa1b1e3bb8eabfa51eec507ba6bf98544d293b2f89a4739945f128f`.
Guest artifacts must later use canonical VFS paths and awaited ByteSink writes;
never pass guest paths into library screenshot/upload filesystem APIs. Retained
bytes require an owned copy, not Buffer.slice/subarray. Size validation after a
screenshot returns limits accepted output, not its prior host allocation.

Regular runtime also confirmed cookie isolation between fresh contexts, that
releasing two borrowed-browser leases left the browser connected, and that a
BrowserType.connect lease detached while the external launchServer browser still
accepted another connection. These are actual local checks, not Cloudflare checks.

### Remote quota, expiry and Worker ownership

Inspected Cloudflare's published declarations and
[limits documentation source](https://github.com/cloudflare/cloudflare-docs/blob/production/src/content/docs/browser-run/limits.mdx).
The public documentation fetch returned HTTP 403; the docs repository source
was fetched successfully. At this inspection it documents free-plan concurrency
3, one new instance per 20 seconds, and 10 browser minutes per day; paid-plan
concurrency 200 and 3 new instances per second. These are account/service limits,
not constants to hardcode in the adapter. `limits(binding)` returns current
active sessions, maximum concurrency, acquisition allowance and time until next
allowed acquisition; a check is advisory and races other callers.

The source documents 60-second inactivity expiry, configurable up to 10 minutes,
no fixed maximum lifetime while active, and session closure on service rollout.
Published `WorkersLaunchOptions.keep_alive` declares 10,000–600,000 ms with a
60,000 ms default. Library acquisition errors include HTTP status in an Error
message; they do not establish a stable structured retry-after contract. Preserve
failure without adding unlimited retry, hidden keep-alive or automatic replay.
Service deployment, quota exhaustion, expiry timing, disconnected session
survival, guardrails and termination confirmation are **unverified**: no explicit
browser binding, tenant session host or Worker lifecycle was supplied.

The published package README requires `nodejs_compat` and an explicit browser
binding. It describes standard CDP starting in 1.3.0 and a compatibility boundary
at `2026-03-17`, with `no_websocket_standard_binary_type` as a downgrade path.
A future QA deployment should record an explicit compatibility date at or after
that boundary and its full flags. No Worker settings were deployed in this task.

An in-memory adapter/controller is owned by a trusted application lifecycle.
It cannot promise named sessions across independent stateless Worker requests,
isolate eviction or host disposal. `waitUntil()` extends bounded work; it is not
a durable registry or proof of remote end. Durable Objects may provide a
tenant-scoped session owner but live Playwright objects cannot be serialized or
assumed to survive eviction. A trusted owner must dispose all controller-owned
leases, keep borrowed-browser ownership distinct, and reconcile unknown remote
resources after disconnect/partial failure. Reopen is explicit and must not
replay clicks/submissions after loss.

### Shell cleanup and verification routes

Inspected current `contracts/command.ts`, `contracts/plugin.ts`,
`contracts/io.ts`, `contracts/command.md` and the package's cleanup instructions.
CommandDefinition is `{ name, execute(context), ...metadata }`; VirtualShellPlugin
has setup and optional dispose. ByteSink writes are awaited Uint8Array writes;
CommandContext has canonical FS/cwd, signal and optional synchronous
`registerCleanup`. No browser integration is registered by this task.

The later session task must synchronously register cooperative invocation cleanup
before calling adapter.acquire, await all admitted acquisition work, and transfer
a successful lease to controller ownership only after publication. Use shared
idempotent cleanup from finally and the registered barrier. Do not bind the
successful session to a command signal after transfer. Custom hosts lacking the
hook still require finally. Controller/plugin disposal must drain owned leases;
per-command finally must not close a successfully retained agent session.

Measured verification:

- TDD began with a failing module-acquisition test before implementation.
  Twelve adapter lifecycle tests pass, including four added by an independent
  reviewer under the package's stress-review instruction.
- Focused ESLint passes. Strict adapter source/test compilation passes. Pinned
  mixed source/built-declaration consumer checks pass under the conditions above.
- `npm run build:workspaces -- --workspace=virtual-bash` passes. Its first attempt
  failed because node_modules lacked the local office-package workspace symlink;
  restoring that missing install link let the same maintained route pass.
- `npm run typecheck:consumers --workspace=virtual-bash` remains unverified:
  exit 78 before any consumer compilation, because three browser entry bundles
  (docx, Python and Python Worker) supplied by root suffix bundling are absent.
  Selected workspace compilation does not produce those suffix artifacts. No
  fake bundles, gate exclusions, cached pass or public integration claim was added.
- Regular runtime and screenshot inspection pass as described above. No visual
  CLI command changed, so no poe-code CLI screenshot acceptance is claimed.

### Follow-up edge-case QA (2026-09-16)

This follow-up exercises the existing first-task adapter; it does not implement
the later CLI, session controller, ref engine, billing or public exports. No
adapter implementation bug reproduced within its documented trusted-host contract.
The adapter source remained unchanged, SHA-256:
`2288d01105acbfa69b062d2c73c0c7fd9899546fb231dc0dfcd2e3b7a56c72f5`.

- All 21 lifecycle tests pass (the initial 12 plus nine added cases), with no
  skipped cases. Added coverage includes pre-aborted requests, all engine entries
  and headed declarations, captured source-map configuration and callback binding,
  sibling leases on a borrowed browser, asynchronous cleanup barriers and
  reentrant release, individual cleanup failures, acquisition-time close events,
  and cancellation after lease publication. These tests use in-memory fakes;
  engine-map coverage does not establish real Firefox or WebKit acceptance.
- Registered the adapter test by literal path in the maintained integration-input
  test. The focused normal-runner discovery test passes and includes this test in
  the active canonical inventory. This is discovery/forwarding validation, not
  execution of the entire repository suite.
- Focused ESLint and strict source/test TypeScript compilation pass. A fresh
  isolated install of the pinned dependency fixture passes mixed-library source
  and existing built-declaration consumers under the documented bundler settings,
  using TypeScript 5.9.3. The regular-only NodeNext consumer passes with full
  declaration checking. The mixed NodeNext negative probe exits 2 with missing
  Cloudflare Browser/BrowserContext/Page/Locator exports and an unused upload
  negative directive; it is an expected incompatibility, not a passing consumer.
- Real regular Playwright 1.58.2 on Node 22.22.2 and explicitly selected Google
  Chrome 152.0.7977.84 passes concurrent isolated-context acquisition, cookie
  isolation, idempotent release, sibling-context survival with a borrowed browser,
  cancellation before a returned browser is admitted, and actual browser closure
  with exactly one lease notification. Cleanup leaves no acquired contexts.
- The private snapshot probe again distinguishes identical buttons (`e4`, `e5`),
  clicks only the selected element, rejects a stale ref after dynamic replacement,
  and resolves the iframe ref in its owning frame. Public ARIA text still provides
  no refs. These private API probes are regular Chromium evidence only and do
  not qualify a shared product ref engine.
- Inspected the generated 16,768-byte PNG: the page shows the replacement button,
  untouched sibling button, and the iframe button after its targeted click.
  Confirmed the PNG signature and concrete Buffer output. `Uint8Array.from` and
  `Buffer.from` preserve owned bytes after mutation of the intermediate array.
  This is a host-side QA artifact, not evidence of guest VFS or CLI integration.
- Reproduced the pre-publication closure limit with a real context: a deliberately
  nonconforming host closes its new context before returning it, while the browser
  remains connected. Acquisition publishes the context without notification and
  `newPage()` rejects; explicit lease release then notifies. The consumed public
  API cannot detect this missed event. Keep the host publication guarantee above;
  no private closed-state inspection or speculative workaround was added.

Cloudflare launch/connect ownership, opaque partial-acquisition leaks, quota,
expiry, generated Worker types and Worker lifecycle acceptance remain unverified
at the service boundary. No explicit Worker browser binding was provided. The
first task's test status remains open for those checks; the later CLI tasks also
remain open. Temporary probes, dependencies and PNG were created only in the
repository's isolated `out/playwright-edge-qa-20260916/` directory after `/out`
creation failed with a read-only-filesystem error, then purged after recording
these results. No README changes, billing, commits or pushes were made.

Temporary downloads, probes and logs used the repository's `out/` because the
filesystem's absolute `/out` is read-only. They are purged after results are
recorded. Maintained files are only implementation, test/consumer fixtures and
this plan; README, billing, commits, pushes and releases are outside authorization.

### Remaining QA plan (execute manually)

1. Recreate an evidence directory under `/out` (or repository out if unavailable),
   copy the exact dependency and compiler fixtures there, and install with native
   lifecycle scripts disabled. Copy the consumer fixture as consumer.ts, resolving
   its adapter import to the actual source and then freshly built declarations.
   Run the pinned compiler. Run a regular-only NodeNext/full-lib-check fixture
   separately. Verify the negative guards fail under the problematic Worker types.
2. Use an explicitly configured Worker browser binding, compatibility date/flags
   and tenant lifecycle owner. Exercise launch versus connect close, confirm actual
   service session/history state, partial WebSocket/browser setup failures, quota
   rejection and inactivity/service-loss behavior. Record unknown end states
   honestly; do not count source inspection or local mocks as service passes.
3. Qualify a single ref engine's generation/resolution on both real backends,
   including dynamic DOM replacement, identical elements, frame ownership and
   stale refs after navigation/tab/session replacement. Inspect actual PNGs and
   test exact Buffer conversions in the Worker runtime.
4. Run maintained consumer routes after the normal root build has generated its
   suffix bundles. Complete later CLI/controller tasks with actual shell invocation,
   middleware, VFS, cancellation and cleanup barriers, then inspect CLI screenshots.
   Purge temporary artifacts. Do not deploy a billed service, commit or push without
   the corresponding user authorization.

## Findings from current code and upstream

- Safe-bash already supports explicit command plugins through `VirtualShellPlugin`
  and `CommandDefinition`. Python and Node use injected runtime factories.
  No Playwright integration exists in the inspected source.
- `CommandContext` supplies virtual FS, cwd, byte sinks, cancellation, budgets and
  invocation cleanup. Shell output should continue through these contracts.
- Regular Playwright creates browsers with `chromium.launch()` or connects to an
  existing browser. Context/page APIs provide the useful shared integration surface.
- Cloudflare documents `launch(env.MYBROWSER)`, then `browser.newPage()` and
  `page.screenshot()`. Its fork currently identifies upstream version 1.58.2.
  Its source explicitly rejects `chromium.launch()`, `launchPersistentContext()`,
  `launchServer()` and `chromium.connect()`. Passing a Playwright module and calling
  `adapter.chromium.launch()` is therefore insufficient.
- Cloudflare documents limits including full Playwright Test, components, Firefox,
  Android, Electron and videos. Do not infer full compatibility from shared types.
- The upstream agent CLI uses host filesystem registries and spawned daemons.
  Safe-bash should implement virtual commands using the library API; it cannot run
  that CLI unchanged or introduce an implicit host process fallback.
- Sessions survive individual CLI calls. Closing every browser in command-level
  `finally` would break the agent workflow.
- Upstream CLI snapshots contain actionable references such as `e15`. Public ARIA
  snapshot APIs alone have not been verified to provide equivalent references.
  Internal API reuse requires explicit version qualification.

## Recommended integration interface

Keep browser acquisition as the only required adapter operation. Return a fresh,
isolated context and an explicit release function. This also supports pooling and
connections to externally owned browsers without assuming `browser.close()` is
always correct.

```ts
// Proposed declarations, not existing exports.
type BrowserEngine = 'chromium' | 'firefox' | 'webkit';

interface PlaywrightAdapter {
  // No entry means unsupported. Capabilities belong to the configured browser,
  // not just the library: a connected browser may have different restrictions.
  readonly browsers: Partial<Record<BrowserEngine, {
    readonly headed?: boolean; // omitted means unsupported
  }>>;

  acquire(options: {
    readonly acquisitionId: string;
    readonly session: string;
    readonly browser: BrowserEngine;
    readonly headless: boolean;
    readonly signal: AbortSignal;
    // Optional injected reporting capability; see billing contract below.
    readonly usage?: {
      readonly intervalMs: number;
      readonly report: (event: BrowserUsageEvent) => Promise<void>;
    };
  }): Promise<PlaywrightLease>;
}

interface PlaywrightLease {
  readonly context: PlaywrightContext;
  // Includes context closure, browser disconnection and remote session loss.
  // Must immediately notify a subscriber if the lease is already closed.
  onClosed(listener: () => void): () => void;
  release(): Promise<void>;
}

interface PlaywrightCliOptions {
  readonly adapter: PlaywrightAdapter;
  readonly billing?: PlaywrightBillingHooks;
  readonly limits?: {
    readonly maxSessions?: number;
    readonly maxTabsPerSession?: number;
    readonly maxArtifactBytes?: number;
    readonly maxSnapshotBytes?: number;
    readonly actionTimeoutMs?: number;
  };
  readonly replace?: boolean;
}

// A controller owns sessions; its plugin only registers commands.
declare function createPlaywrightCli(options: PlaywrightCliOptions): {
  readonly plugin: VirtualShellPlugin;
  dispose(): Promise<void>;
};
```

`PlaywrightContext` is an owned structural subset of the public Playwright
BrowserContext API. Define only the methods consumed by supported commands:
initially `newPage()`, `pages()` and page/locator operations for navigation, input,
screenshots and snapshots. Add `storageState()` and cookie operations when those
commands are implemented. Page operations use native public methods such as
`goto()`, `locator()`, `getByRole()`, `getByTestId()`, `keyboard`, `screenshot()`
and `close()`. Artifact methods return bytes; path arguments are excluded.

Write the exact structural declarations against pinned regular and Cloudflare
consumer fixtures before accepting this interface. Avoid exporting an entire
Playwright module type or copying its entire API. This keeps safe-bash free of a
runtime Playwright dependency and permits differing upstream type versions.

No `provider` string, provider switch, logging hook or dry-run logic belongs in
the adapter. Browser declarations are facts used for generic preflight. Add optional
features only alongside commands that consume them; do not design a generic RPC
operation union now. Context emulation options can be added to the acquisition
request when the selected CLI's supported flags require them.

## Regular and Cloudflare host wiring

The following are proposed usage sketches. The application supplies the adapter;
safe-bash never imports these browser libraries or launches a native CLI.

```ts
import { chromium } from 'playwright';

const regularAdapter: PlaywrightAdapter = {
  browsers: { chromium: { headed: true } },
  async acquire({ headless, signal }) {
    signal.throwIfAborted();
    const browser = await chromium.launch({ headless });
    try {
      signal.throwIfAborted();
      const context = await browser.newContext();
      signal.throwIfAborted();
      // Production adapter also supplies onClosed and idempotent release;
      // see the ownership contract below. This is an acquisition sketch only.
      return makeOwnedLease(context, browser);
    } catch (error) {
      await browser.close();
      throw error;
    }
  },
};
```

```ts
import { launch } from '@cloudflare/playwright';

// Construct inside an authorized Worker lifecycle with an explicit binding.
const cloudflareAdapter: PlaywrightAdapter = {
  browsers: { chromium: {} },
  async acquire({ signal }) {
    signal.throwIfAborted();
    const browser = await launch(env.MYBROWSER);
    try {
      signal.throwIfAborted();
      const context = await browser.newContext();
      signal.throwIfAborted();
      return makeOwnedLease(context, browser);
    } catch (error) {
      await browser.close();
      throw error;
    }
  },
};
```

`makeOwnedLease` denotes adapter-side lifecycle work still to implement, not an
existing helper or a pass-through wrapper. It tracks context closure/browser
disconnection, implements subscribe/unsubscribe and shares one release promise.
Failed releases remain failures; repeat callers must observe the same result.
Use `AggregateError` when acquisition and cleanup both fail to preserve both
causes. The abbreviated catch blocks above do not yet implement that policy.

These sketches provision Chromium only. A regular adapter can use an injected
engine-to-launcher map to support other engines. Connected/pool adapters release
only their owned context and connection according to the host ownership contract.
`release()` must be idempotent, cover partially completed acquisition and observe
late completion. Signal checks do not forcibly cancel Playwright's launch calls;
the adapter owns cleanup of work that completes after cancellation.

## Backend differences and required handling

| Difference | Regular Playwright | Cloudflare | Required integration behavior |
| --- | --- | --- | --- |
| Acquisition | BrowserType launch/connect APIs | Binding-based `launch`/`connect`; standard launch methods rejected | Adapter owns transport and credentials. Shared command code calls only `acquire`. |
| Engines and launch flags | Depends on configured launcher; Chromium, Firefox and WebKit possible | Documented Chromium-oriented service; no regular local executable/channel launch contract | Browser map preflight rejects unavailable engines, `--headed`, channel/profile/launch flags. Never ignore a requested option or substitute an engine. |
| Ownership on close | Launched browser, pooled browser and CDP connection have different ownership | Inspected `launch` installs a `Browser.close` handler; `connect` follows a different connection path | Explicit adapter lease decides termination versus disconnection. Verify connected release does not kill externally owned browsers. |
| Lifetime | Owned host controller can retain live objects | Remote keep-alive, connection lifecycle, Worker execution lifetime and isolate eviction are independent | Declare deployment session policy. Never equate CLI idle timeout with service keep-alive or promise persistence across Worker requests. |
| Quotas | Host resource/capacity limits | Remote concurrent-session and acquisition limits | Fail capacity explicitly. No automatic replay of clicks/submissions or unlimited retries. |
| Files | Library path options can touch host FS | Documented trace example uses Worker `/tmp`, not shell VFS | Never pass guest paths to library FS APIs. Use bounded byte artifacts and explicit bridges. |
| Binary types | Screenshots/PDF and upload buffers use Node-compatible Buffer contracts | Fork uses compatibility APIs; actual types/runtime need qualification | Copy returned bytes to owned Uint8Array; upload adapter converts input bytes to the exact library buffer type. Uint8Array assignability is not assumed. |
| Snapshots | Latest upstream includes APIs newer than older releases | Inspected wrapper explicitly lists locator `ariaSnapshot`; newer page/JSON methods are not established | Pin matching API versions. Do not assume current Microsoft main signatures exist in the fork. Qualify reference generation/resolution together. |
| Optional features | Vary by engine, connection and version; PDF is Chromium-specific | Docs exclude video and full test runner; remaining support is not exhaustive | Expose optional operations only after real-backend qualification; missing operation produces an unsupported-feature error. |
| Browser egress | Host must supply enforcement | Inspected source has acquisition-time session guardrails | Policy stays in the trusted adapter; never accept guest overrides or reconnect under an unverified policy. |

Additional acceptance rules:

- Validate browser and every requested option before acquisition, VFS output
  creation or navigation. Keep capabilities per configured engine. An adapter
  that claims support must actually apply the option; no silent defaults.
- `onClosed` must be installed before session publication. Session state moves
  through acquiring/open/closing/closed, and each open gets a new generation.
  A late event from an old lease must not close a replacement session. Remove
  listeners on retirement and invalidate all tab and element references.
- On service loss, discard live page/locator objects. Return a clear session-closed
  error and require explicit reopen. Reconnect must never silently replay actions
  or reuse stale refs, even if a remote browser session still exists.
- Cloudflare's declared `keep_alive` is currently 10,000–600,000 ms, default
  60,000 ms. This is host service configuration, not an exact implementation of
  `open --idle-timeout`. The source declaration says no-activity keep-alive;
  disconnected-session behavior must be tested. Any effective shorter lifetime
  must be documented, not extended through hidden keep-alive loops.
- A plain stateless Worker cannot use the in-memory controller as a durable
  cross-request session registry. For agent CLI sessions, qualify a tenant-scoped
  lifecycle owner with appropriate request routing/storage, or constrain calls
  to one host execution. Remote session IDs alone do not preserve local tab/ref
  bookkeeping. This is a required deployment decision, not an adapter guarantee.
- In the inspected Cloudflare source, `launch` acquires a remote session before
  connecting. A failure before a browser object is returned can leave no local
  handle to close. The simple example cannot guarantee cleanup of that case:
  qualify staged acquisition/recovery or an upstream cleanup path, and document
  bounded service expiry if immediate cleanup is unavailable. Track failure
  without claiming successful retirement or releasing accounting prematurely.
- Normalize only recognized adapter failures into shared codes such as
  `UNSUPPORTED`, `CAPACITY`, `SESSION_CLOSED` and `TIMEOUT`, retaining the original
  cause privately. Cloudflare source currently throws generic Error messages
  for HTTP failures; do not invent status properties or classify arbitrary text
  as capacity exhaustion. Unknown failures stay failures, with redacted diagnostics.
- Tracing/downloads need separate artifact bridges when added. `tracing.stop`
  path output and native download streams are not portable VFS operations.
  A trusted adapter may bridge temporary artifacts, with bounded reads and
  guaranteed cleanup; otherwise report unsupported. Storage-state loading also
  needs version qualification: do not assume an existing context has a setter.
- Enforce output budgets during collection where the API permits. Screenshot
  APIs return a fully allocated buffer; a post-return size check limits accepted
  artifacts, not browser/host peak memory. Do not claim allocation isolation.

```ts
const cli = createPlaywrightCli({ adapter: cloudflareAdapter });
const shell = new Shell({ fs, cwd: '/work' }).use(cli.plugin);
try {
  await shell.exec('playwright-cli -s=demo open https://example.com');
  await shell.exec('playwright-cli -s=demo snapshot');
  // Use a reference actually emitted by the snapshot.
  await shell.exec('playwright-cli -s=demo screenshot --filename=page.png');
} finally {
  await shell.dispose();
  await cli.dispose();
}
```

## Injected billing capability — declarations only

Requested scope: prepare the capability and hooks; do not implement billing,
metering timers, persistence, rate calculations, balances, payment calls or a
Cloudflare usage collector yet. No hardcoded prices belong in runtime code.
Current billing scope is live browser duration only. Concurrency charging and
daily/monthly peak accounting are deferred. Operational session capacity limits
still apply independently of billing.
The browser adapter reports facts; a separately injected billing host owns pricing
and accounting. Billing identity is bound by trusted host configuration, never
guest flags, environment variables or page content.

### Usage mechanism

Checked the [current pricing documentation](https://developers.cloudflare.com/browser-run/pricing/)
on 2026-09-16; the page reports last updated 2026-04-21. Browser Rendering is now
named Browser Run. The relevant unit for this feature is browser lifetime in
milliseconds, including idle time while the browser remains open.

Expose cumulative milliseconds per browser resource while it is alive, at a
host-configured reporting interval, followed by a final usage report on closure.
The injected `onUsage` handler can charge incrementally during the session.
Reporting must continue between commands; command-completion hooks alone are
insufficient. No commands or keep-alive traffic are sent merely to obtain a usage
tick, and metering must not extend the browser's lifetime.

Cloudflare explicitly says an unclosed browser continues consuming browser time
until timeout, including inactivity. Chargeable time does not pause between CLI
actions. Explicit browser closure or confirmed service expiry ends the interval;
local disconnection alone does not establish an end.

Hooks report unrounded usage. Rates, allowances, billing periods, rounding and
customer charging are entirely the injected host's responsibility.
`X-Browser-Ms-Used` is documented for Quick Actions, not Playwright commands.
Local session elapsed time is marked estimated until provider billable-duration
semantics have been qualified, including idle, disconnect and expiry behavior.
Idle time counting itself is confirmed by the
[Cloudflare usage FAQ](https://developers.cloudflare.com/browser-run/limits/#why-is-my-browser-usage-higher-than-expected):
the default inactivity timeout is 60 seconds and `keep_alive` can extend it to
10 minutes. Exact timestamps/usage totals still require backend qualification.

### Proposed hooks and usage facts

```ts
interface PlaywrightBillingHooks {
  // Required when billing is injected: a positive, finite integer.
  // Host chooses charging cadence; no implicit default.
  readonly intervalMs: number;
  // Runs before acquisition or other browser-creating operations. Rejection
  // prevents acquisition; this is authorization, not a completed charge.
  beforeAcquire?(request: {
    readonly acquisitionId: string;
    readonly session: string;
    readonly browser: BrowserEngine;
    readonly signal: AbortSignal;
  }): Promise<void>;

  // Awaited periodic live usage, final usage and lifecycle/reconciliation facts.
  // Caller charges duration here; rejection retires the affected browser.
  onUsage(event: BrowserUsageEvent): Promise<void>;
}

type BrowserUsageEvent = {
  readonly eventId: string;        // stable across delivery retries
  readonly acquisitionId: string; // correlates attempts, including partial launch
  readonly resourceId: string;    // billable browser identity, not tab/lease ID
  readonly revision: number;      // ordered per resource; corrections increase it
  readonly observedAt: string;    // UTC ISO timestamp
} & (
  | {
      readonly type: 'started';
      readonly startedAt: string;
      readonly accuracy: 'provider' | 'estimated';
    }
  | {
      readonly type: 'usage';
      readonly cumulativeBrowserMs: number;
      readonly through: string;
      readonly accuracy: 'provider' | 'estimated';
      readonly final: boolean;
    }
  | {
      readonly type: 'ended';
      readonly endedAt: string;
      readonly accuracy: 'provider' | 'estimated';
    }
  | {
      readonly type: 'unknown';
      readonly reason: 'acquisition-failed' | 'connection-lost' | 'cleanup-failed';
    }
);
```

The controller supplies `usage: { intervalMs, report }` to acquisition when
billing is injected. The adapter owns resource-lifetime observation and reports
facts even when no CLI command is executing, including allocation before a lease
can be returned. An adapter unable to support live reporting must reject billing
configuration before allocation. A trusted external reconciler may submit later provider facts to
the same billing host. This is an interface proposal, not an available collector.
Do not manufacture provider accuracy from local clocks or public session-history
timestamps unless their billing semantics have been verified.

```ts
// Proposed injection: application callbacks are supplied by the caller.
const cli = createPlaywrightCli({
  adapter,
  billing: {
    intervalMs: 1_000,                   // caller-selected reporting cadence
    beforeAcquire: authorizeBrowserUsage, // optional balance/permission check
    onUsage: chargeBrowserUsage,         // charge new duration on each usage report
  },
});
```

Hook contract for eventual implementation:

- Stable acquisition IDs exist before authorization. Authorize once per new
  browser acquisition, not per click. If additional browser creation is added,
  it also passes through authorization. New tabs in the same browser do not
  add another billable duration interval.
- Resource IDs survive reconnects and distinguish browser sessions from local
  leases. Shared browser contexts must not multiply upstream usage. A resource
  shared across customers needs host attribution policy or must be disallowed;
  do not independently bill its full duration to every customer.
- Each live usage event reports cumulative browser milliseconds, not a new
  standalone charge quantity. The host charges the difference from its last
  accepted cumulative total. Duplicate event IDs and older revisions produce no
  new charge; a later correction reconciles the prior amount rather than charging
  the whole total again. Observed time and provider event time are distinct.
- Use a monotonic clock for local elapsed duration. Serialize reporting per
  resource, await the handler and allow at most one report in flight. If a
  handler is slow, coalesce ticks into the next cumulative report without
  dropping elapsed time or queuing unbounded callbacks. Charging cadence is
  cooperative; it is not an exact real-time settlement guarantee.
- At confirmed closure, stop live reporting and emit final cumulative usage
  including the partial interval since the last report. Close/drain ownership
  prevents late ticks from adding time after the confirmed end. Idle timeouts,
  explicit close and controller disposal all follow the same finalization path
  when browser retirement is confirmed.
- A disconnected lease is not proof that the remote billable browser ended.
  Emit unknown state and reconcile; failed cleanup must not emit a false final
  end or zero usage. Provider-confirmed end may arrive after controller disposal.
- Billing authorization failure prevents browser effects. A usage-hook failure
  cannot undo incurred provider usage: preserve the reporting error, attempt
  owned cleanup and mark accounting unresolved. This allows the caller to reject
  continued use when credit is exhausted; closure latency can still incur usage.
  Never retry browser actions to
  retry reporting. Durable delivery and idempotency belong to the injected host;
  this proposal makes no exactly-once guarantee.
- Cleanup/reporting gets a host-owned lifecycle deadline rather than only the
  already-aborted command signal. Billing failure must not skip browser cleanup.
  Absence of billing hooks leaves accounting to the host; it never implies
  Cloudflare usage is free.
- A regular Playwright adapter can report the same duration with locally
  measured accuracy, and the injected billing host may apply the same tariff.
  It must not label those measurements Cloudflare provider usage.

Future qualification must cover duplicated events, corrections, reconnect under
the same resource ID, failed partial acquisition, cleanup failure, delayed final
usage, idle sessions with no commands, periodic incremental charges, slow/failing
handlers, credit rejection, final partial intervals and clock changes. Concurrency
billing cases are outside the current scope.
For now, only this plan/interface changes; no billing code or charges are added.

## Session, file and execution contracts

- The controller is explicitly scoped to one workspace/tenant and owns its session
  map. Never use a global singleton or share contexts across unrelated consumers.
- Session selection follows explicit `-s`/`--session`, exported
  `PLAYWRIGHT_CLI_SESSION`, then the upstream default session. Validate names and
  keep identifiers separate from VFS paths.
- Serialize operations in a session, allow separate sessions concurrently and
  enforce capacity before acquisition. Account for idle expiry and remote session
  loss; report a closed session and require reopen rather than replaying actions.
- Register cooperative cleanup before invocation-owned acquisition. Failed or
  cancelled `open` releases its lease; a successful `open` transfers ownership to
  the controller. Ordinary completed commands retain the session. `close`, idle
  expiry and controller `dispose()` drain work and release leases exactly once.
- Active-command cancellation retires the affected session to stop outstanding
  browser work where cooperative context/connection closure permits. It cannot
  undo clicks or submissions already performed. Observe all late rejections.
- All guest artifacts use cwd-relative VFS paths and owned bytes, with admitted
  size limits and awaited writes. Call `screenshot()` without a native `path`.
  Load storage from parsed virtual JSON and save the returned object to VFS.
  Uploads use `{ name, mimeType, buffer }` from bounded VFS reads with explicit
  adapter-side conversion to the library's required buffer type.
- Snapshot output links point to real VFS artifacts, and diagnostics use stderr.
  Preserve upstream output and exit behavior for the supported command subset.
  Do not invent process IDs for virtual sessions.
- Browser networking is a separately granted host capability. Existing curl
  authorization does not automatically govern it. The adapter must document and
  enforce the application's browser egress policy; request interception alone
  must not be described as a complete network sandbox.
- Do not evaluate guest `run-code` or locator strings in the host JavaScript realm.
  Structured locator parsing is possible without regexes. Page `eval` and trusted
  Playwright script execution are separate capabilities requiring explicit design.

## Initial implementation and validation plan

1. Settle the CLI target and pin integration dependency versions. Verify both real
   adapters can create an isolated context, navigate, operate a locator, return
   screenshot bytes and clean up after errors/cancellation.
   Record the regular library version, Cloudflare package version, underlying
   Playwright version, Worker compatibility date/flags and browser service mode.
   Inspected Cloudflare main is `1.3.6-next`; main-source features are not evidence
   that an installed stable package includes them.
2. Resolve snapshots and references before advertising agent CLI compatibility.
   Investigate whether a public API supports upstream reference semantics on both
   pinned versions. If internal APIs are necessary, isolate and version-test that
   integration; otherwise design a shared reference engine and qualify output.
   Test stale refs, navigation, frame handling and identical-looking elements.
3. Implement command/session logic in a focused package, provisionally
   `@poe-platform/safe-playwright`, with only shell registration/stream wiring in
   safe-bash. Package name/export paths remain a proposal. Its README requires
   user permission and must document all config/environment options.
4. For the agent target, first deliver `open`, `goto`, `snapshot`, `click`, `fill`,
   `press`, `screenshot`, tab commands, `list`, `close` and `close-all`. Label it a
   supported subset. Explicitly reject unsupported flags before browser effects.
   Do not promise installation commands, host profiles, dashboards, forced process
   killing, video or `run-code` parity. If the standard target is chosen, start
   with screenshot/PDF commands and qualify PDF support on both adapters.
5. Use TDD with fake structural contexts and memfs for shell invocation, quoting,
   VFS artifacts, bounded output, session isolation, concurrency and cleanup,
   including late acquisition and disposal races. Fast unit tests do not launch
   browsers. Add pinned type-consumer checks for both implementations.
6. Execute a markdown QA plan against regular Playwright and a configured
   Cloudflare browser binding, with actual screenshots inspected. Compare CLI
   stdout/stderr, artifact contents and exit statuses for supported operations.
   Run maintained checks appropriate to the eventual changed packages.

Required differential cases before integration is considered ready:

- Unsupported engine/headed/profile/option requests produce no browser or files.
- Owned release terminates its browser; borrowed release preserves external tabs.
- Abort during launch, after remote acquisition and during navigation; verify
  late completion cleanup and failed-cleanup accounting.
- Remote disconnect, service expiry, quota rejection and Worker-owner restart;
  ensure sessions/ref generations cannot be accidentally resurrected.
- Parallel same-session calls, close/open races and dispose during acquisition;
  ensure no leaked leases, listener retention or duplicate release.
- Screenshot bytes decode correctly on both backends; guest paths remain in VFS.
  Verify uploads with converted buffers and no native guest-path lookup.
- Snapshot refs identify the same intended elements on both backends, including
  stale refs, dynamic DOM changes, tabs and frames.
- PDF, tracing, storage and downloads are enabled only when their exact backend
  operation has passed qualification; negative cases return explicit diagnostics.

## Investigation sources

- Current integration contracts: `packages/safe-bash/src/contracts/command.ts`,
  `plugin.ts`, `io.ts`; existing Python and Node commands; safe-bash README.
- [Cloudflare README and limits](https://github.com/cloudflare/playwright/blob/main/README.md)
- [Cloudflare launch implementation](https://github.com/cloudflare/playwright/blob/main/packages/playwright-cloudflare/src/index.ts)
- [Cloudflare unsupported launch operations](https://github.com/cloudflare/playwright/blob/main/packages/playwright-cloudflare/src/cloudflare/unsupportedOperations.ts)
- [Cloudflare public binding, session and launch declarations](https://github.com/cloudflare/playwright/blob/main/packages/playwright-cloudflare/index.d.ts)
- [Cloudflare wrapped client APIs](https://github.com/cloudflare/playwright/blob/main/packages/playwright-cloudflare/src/cloudflare/wrapClientApis.ts)
- [Cloudflare development package version](https://github.com/cloudflare/playwright/blob/main/packages/playwright-cloudflare/package.json)
- [Agent CLI command and session documentation](https://github.com/microsoft/playwright-cli/blob/main/README.md)
- [Agent CLI host lifecycle](https://github.com/microsoft/playwright/blob/main/packages/playwright-core/src/tools/cli-client/program.ts)
- [Standard CLI commands](https://github.com/microsoft/playwright/blob/main/packages/playwright-core/src/cli/program.ts)
- [Public Playwright types](https://github.com/microsoft/playwright/blob/main/packages/playwright-core/types/types.d.ts)

Upstream main branches are moving references. The initial source/documentation
investigation was superseded by the pinned qualification and regular Chromium
runtime evidence above. Exact shared snapshot compatibility and Cloudflare
service acceptance remain unverified.
