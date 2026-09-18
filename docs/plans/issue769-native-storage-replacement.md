# Native same-context storage replacement (#769)

## Scope and validated regression

The delivered fallback called `replaceContext` when the acquired native context
lacked `setStorageState`. The actual Cloudflare Playwright 1.3.6/local workerd
regression returned success but lost native context/tab identity and per-tab
sessionStorage. Native Node Playwright's setter already preserved those objects.

Keep the native setter unchanged. Otherwise require an explicitly acquired
native storage control capability. Missing control is an explicit command error;
it is not a provider-impossibility claim and never silently resets the context.
No provider-ID branch, workspace filesystem, credentials, HTTP proxy, domain
policy, public-page script suppression, or service-worker ban is introduced.

## Acquired control contract

`PlaywrightBrowserSource.acquireBrowser` may return `prepareStorageOrigin`.
`createPlaywrightStorageOriginPreparer` and
`createPlaywrightPrivateTargetTransport`, with their public types, are exported
through the Playwright command entrypoint.

The host establishes two connections to the same owned native browser resource:

1. Wrap the native Playwright client connection with the private-target transport
   **before** connecting the native client. The transport is not a page-network
   proxy. It keeps internally created targets out of the native client's page
   discovery/init-script machinery.
2. Supply an independent native CDP control connection to
   `createPlaywrightStorageOriginPreparer(control, privateTargets)`. `send` retains
   exact flattened-session correlation; `subscribe` forwards native events.
   The host rejects pending session commands on native session detachment and
   pending commands on connection termination. A timer alone is not evidence of
   target retirement. Host acquisition/release also owns both connections and
   cleanup if connection setup fails before returning a resource.
3. Return the resulting `prepareStorageOrigin` alongside `browser` and `release`.

The adapter binds each exact new context before exposing it. It obtains the
context ID from `Target.getTargetInfo` on an existing native public page or a
temporary blank native page created before any consumer init scripts. Temporary
page/session cleanup is awaited. This is not a caller-asserted context ID.

Each prepared lease is `{cdp, targetId, browserContextId, release}`. Creation is
shielded; the independent native control verifies target/context identity,
disables document script execution on that target, and uses a target-scoped
synthetic blank navigation. Existing public tabs and normal networking remain
native. The operation rechecks target identity, context ID, frame origin, and
browser-realm origin before running its serialized callback in an isolated world.
It never fabricates a Playwright Page for a hidden target.

Release is idempotent and joins actual `Target.targetDestroyed`. Cancellation
closes the private target to interrupt pending evaluation. Late acquisition,
detach, release, and admitted operations are drained; the context-owned binding
is retired before the adapter closes its context. Execution and cleanup errors
remain observable together.

## Census, replacement, and readback

Before destructive work, request actual native
`storageState({indexedDB: true})` and validate its owned snapshot, including closed
IDB-only origins. Merge current data from imported-only origins that the native
client cannot discover because their write targets were private. Retain **origin
names**, not cached imported values, in an exact-context WeakMap. Read those
origins again for every save/census. Successful replacement resets tracking to the
current replacement's origins; disposal clears it. Current census, imported
origin names, and aggregate readback remain under the caller's storage bounds.
Browser-realm collection checks its remaining budget before transferring results.
The underlying native `storageState` API itself transfers its snapshot before
library validation; this is not a native browser heap or transport-memory cap.

Replace cookies, localStorage, and IndexedDB in the same context. Existing tab
sessionStorage is untouched. The origin callback unregisters service workers as
the native storage reset does; that is not a ban on service-worker use. Existing
native controllers can still serve normal fetches after unregistration.

`state-save` preserves CLI 0.1.20's default without IndexedDB. The internal native
census/read helper requests IndexedDB explicitly when needed. No new
`state-save --indexed-db` option is added. Imported-only readback obtains current
native localStorage/IDB, including intervening native mutations. A later empty
load removes that origin's data even if no public page ever visited it.

Replacement is not transactional. Failure/cancellation can leave partial native
effects, like native browser storage operations. Validation failures before
destructive work have no replacement effects; no rollback or atomicity guarantee
is made.

## Qualification

Owned maintained tests:

- `packages/safe-bash/tests/plugins/playwright-native-storage-replacement.test.ts`:
  native identity, census-before-effects, bounds, foreign leases, late acquisition,
  pending cancellation, cleanup errors, current readback, disposal and ownership.
- `packages/safe-bash/tests/plugins/playwright-native-storage-targets.test.ts`:
  shielded target creation, synthetic target-only navigation, joined retirement.
- `packages/safe-bash/tests/plugins/playwright-native-storage-public.test.ts`:
  public command-entrypoint runtime imports and acquired-resource type composition.
- `packages/safe-bash/tests/plugins/playwright-standard-capabilities.test.ts`:
  native setter and explicit missing-capability behavior; no reset fallback.
- `packages/safe-bash/tests/plugins/playwright-native-storage-preservation.test.ts`:
  actual native Chromium and actual CF 1.3.6 using Miniflare's BROWSER binding.
  Same context/selected page/tabs, separate sessionStorage values, omitted closed
  IDB-only origin, imported-only save, intervening mutation, second-load removal,
  requested/default IDB, typed/cyclic/bigint/explicit-null restoration, and native
  service-worker behavior. CF also exercises pending evaluation cancellation and
  joined target destruction.
- `packages/safe-bash/tests/plugins/playwright-native-storage-hidden.test.ts`:
  actual CF independent control, early/late init-script suppression, privileged
  isolated-world evaluation while document scripts are disabled, public positive
  controls, native identity and actual target/session retirement.

The SW comparison observed one document-fetch witness during state-load on both
the native setter and the CF replacement, and zero during the initial census in
this workload. Ordinary SW-backed fetch worked before and after; registrations
were removed by both. Do not claim a globally no-script/no-network census stronger
than native Playwright, or treat the matching native witness as a new blocker.

The IDB fixture uses native exported data plus an explicit `{v: 'null'}` record:
the pinned CF snapshot serializer omitted both value fields for a standalone null
record. This known native-export behavior is not evidence against the replacement
decoder, and the fixture does not silently reconstruct arbitrary lost native data.
An explicit `value: null` without `valueEncoded` also follows the native setter's
nullish fallback to undefined; the native and CF tests distinguish this from the
lossless explicitly encoded null form.

Runtime qualification pins: `@cloudflare/playwright@1.3.6`,
`miniflare@4.20260708.1`, `workerd@1.20260708.1`, native
`playwright@1.64.0-alpha-2026-09-14`, Chromium headless shell build 1200.
The tests import/bundle this source through the public command entrypoint where
applicable; they are not a published-package or deployed-account claim.

Run the focused unit tests with the existing independently installed `tsx` and
`TSX_TSCONFIG_PATH=packages/safe-bash/tsconfig.json`. The actual integration tests
are opt-in using `SAFE_BASH_STORAGE_RUNTIME` (the independent tooling package),
`SAFE_BASH_STORAGE_CHROMIUM` (the existing executable), `SAFE_BASH_STORAGE_OUT`
and `TMPDIR` (both under home). Add `SAFE_BASH_STORAGE_CF=1` for the CF preservation
test, together with the existing workerd binary in `MINIFLARE_WORKERD_PATH` and
the isolated fixture `HOME`/`XDG_CACHE_HOME`. Run each file with
`node --import "$SAFE_BASH_STORAGE_RUNTIME/node_modules/tsx/dist/loader.mjs" --test`.
Logs/generated reports stay under this worktree's
`out/issue769-storage-replacement/`; no credential transfer is needed.

## Delivery boundaries

This is a same-context storage milestone, not completion of #769 or universal
native parity. The actual CF proof is a local workerd Browser Rendering binding,
not an account deployment. A consumer must wire the trusted acquisition/control
connections; the library does not infer ambient Cloudflare credentials or IDs.
Broader cache semantics and raw native error/serialization byte parity are not
established by these tests. The private transport's separate response-session
correction is owned by Nash; preserve its strict pending-ID/session correlation
and adversarial controls when integrating that dependency.

The combined qualification includes Nash's exact commit
`baa7bdcad4598f19497d25592a3209d31e0ead46` (local cherry-pick `9fc090007`) after
the recovered four-commit private transport chain. Final focused unit coverage is
97 passing tests, including the existing adapter/transport suites and public
entrypoint test. Scoped strict types pass. Actual native and CF evidence is in
`native-final.tap`, `cf-final.tap`, and `cf-final-repeat-*.tap` under the owned
output directory; root suites, root lint, deployment and publication are not
claimed by this worktree.
