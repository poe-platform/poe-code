# Issue 774 independent public storage qualification

## Ownership and admission

This detached home sidecar starts at
`fd721cb4325835783fca40ca4734b59dbbb1b801`. The claimed producer owns product
changes; this sidecar changes no adapter, private transport or native storage
source. Original issue body and claim are preserved in
`out/issue774/issue.json`.

Baseline is exact registry `@poe-platform/safe-{bash,fs,js}@0.1.689`, source
`fd721cb4325835783fca40ca4734b59dbbb1b801`. The maintained publication verifier
admitted all archives, SRI and provenance, installed all three into this
worktree's own output and checked Node imports. Bundler inputs reject checkout
product source, product artifacts from tooling installations and symlinks.

Delivered fix source is `127a70445704559648bd48843853843c5d25a1b0`, verified
on remote main and recorded in `out/issue774/delivered-source.json`. The issue
closing comment is preserved in `out/issue774/issue-after-delivery.json`.
Scoped run 35379033693 failed. The subsequent announced publication is exact
`0.1.690`, source `6256c18023b9d3895c0807717817af4657449e1d`, run 35379423931.
The delivered fix is an authenticated ancestor of that source; the only
intervening commit allows absent initial context options. Source binding evidence
is `out/issue774/source-binding-0.1.690.txt`.
Never substitute a guessed release, source overlay or locally packed candidate
for exact published qualification. Publication receipts alone do not admit
registry artifacts: bounded independent admission is required first.

## Terminal baseline

Actual CF1.3.6 with local workerd BROWSER binding, not a deployed account:

- Seed an active-tab IndexedDB database and close the application connection.
  Public `state-load` returns exit 1, `isError: true`,
  `Runtime.evaluate timed out` in 10,050 ms.
- Native `context.storageState({indexedDB:true})` is called once; no owned
  closing reader is used. The deliberately held connection case likewise
  times out in 10,046 ms instead of an explicit blocked-request failure.
- Both cases retain exact context, selected page, two native target identities
  and each tab's sessionStorage, with zero user close/navigation events.
- Public cancellation reports `issue774-public-cancel` in 60 ms and joins
  cleanup: zero tracked leases, one host release, remote session absent.
- The prior installed-storage smoke passes on the same artifacts. It had no
  active-tab database at census time and therefore did not expose this leak.

Actual native Chromium using its unchanged Node setter passes active-origin,
closed historical IDB-only origin and initial-state IDB-only origin deletion,
repeated load, target/session preservation and host cleanup. This is a native
setter control, not a substitute for the setter-free CF proof.

Evidence is under `out/issue774/0.1.689/`: `cf.log`, `native.log`,
`cf-existing.tap`, and each new mode's `inputs.json`, `report.json`,
`controls.json`. Admission evidence is `out/issue774/admission-0.1.689.log`.
The initial terminal fixture preceded the additional closing-reader result,
lease/detach, default-save and second-cycle identity assertions described below;
those additional assertions are prepared, not claimed tested by these reports.

## Post-fix prepared controls

The bounded output-only public harness is `out/issue774/{admit,run,driver}.mjs`.
It uses public CLI/adapter/preparer/transport and memory VFS imports only.
Its next exact installed run must prove:

- No native indexedDB:true census call; owned closing-reader responses include
  actual databases from the live origin, the already closed historical origin
  and the unvisited initially supplied IDB-only origin.
- Empty replacement removes databases at all three origins, including a second
  load after intervening native database creation. Default save omits IndexedDB.
- The newly exported public `readPlaywrightStorageState` reads actual initial,
  historical and active IndexedDB data with the indexedDB option enabled and
  no native indexedDB:true collector invocation. Missing export fails explicitly
  without a reader fallback.
- Original context, selected target, both user target identities and distinct
  sessionStorage survive both loads. No user tab reload or close releases locks.
- An existing deliberately held native connection is intentionally released by
  the supported same-context `Storage.clearDataForOrigin` operation with only
  `indexeddb`, so restore succeeds while a second context on the same origin
  retains its database and local/session storage. The held handle becomes closed.
- Separately, a native adversarial race recreates a held connection after clear
  but before restoration evaluation. If that delete request is blocked, it must
  report an explicit blocked error in under five seconds, before the harness's
  ten-second transport timer. This is an intentional native race in the host
  fixture, not evidence that ordinary held-connection restore should fail.
  It covers deleteDatabase.onblocked; no independent version-upgrade open.onblocked
  proof is claimed.
- Public cancellation at owned evaluation drains target destruction/detach,
  all issued leases retire, host release occurs exactly once, the owned browser
  disconnects and the owned remote session is absent.

Run admission only after the exact source/version is announced:

```sh
export ISSUE774_VERSION=0.1.690
export ISSUE774_SOURCE=6256c18023b9d3895c0807717817af4657449e1d
node out/issue774/admit.mjs > "out/issue774/admission-$ISSUE774_VERSION.log" 2>&1
export ISSUE774_ADMISSION="$PWD/out/issue774/$ISSUE774_VERSION/installation.json"
export SAFE_BASH_STORAGE_RUNTIME=/home/kjopek/project/poe-issue-worktrees-20260918/issue-769-eval/out/issue769-eval/runtime
export SAFE_BASH_STORAGE_CHROMIUM=/home/kjopek/.cache/ms-playwright/chromium_headless_shell-1200/chrome-headless-shell-linux64/chrome-headless-shell
export TMPDIR="$PWD/out/issue774/tmp"
export SAFE_BASH_STORAGE_CF=0 ISSUE774_OUT="$PWD/out/issue774/$ISSUE774_VERSION/native"
node --import "$SAFE_BASH_STORAGE_RUNTIME/node_modules/tsx/dist/loader.mjs" out/issue774/run.mjs
```

For CF set `SAFE_BASH_STORAGE_CF=1`, choose its own `cf` output directory and
reuse the existing isolated home runtime:

```sh
export HOME=/home/kjopek/project/poe-issue-worktrees-20260918/issue-769-eval/out/issue769-eval/container-home
export XDG_CACHE_HOME="$HOME/cache" CI=1
export MINIFLARE_WORKERD_PATH=/home/kjopek/project/poe-issue-worktrees-20260918/issue-769-eval/out/issue769-eval/workerd-compat/workerd
```

## Remaining qualification boundaries

Independent exact-public execution is complete. Admission observer one terminated
after 30 attempts with safe-js metadata still 404; a fresh bounded observer
succeeded on attempt three. Admission log is
`out/issue774/admission-0.1.690-retry.log`. Lock SHA256 is
`479149036a547dd22cd8438a1fcc58afe18890e31055451f713bcb7748f84b13`.

All four actual CF/local BROWSER cases and one actual native Node setter case
passed. CF's 20 controls are true:

- Ordinary restore succeeded in 152 ms with zero native indexedDB:true census
  calls. Public checkpoint and owned-reader responses include actual active,
  closed historical and unvisited initial IndexedDB databases.
- Repeated replacement after native mutation succeeded with original targets,
  selected page, tabs and sessionStorage preserved; default save omits IndexedDB.
- Deliberately held connection clear succeeded in 165 ms and closed the held
  handle, while the independent same-origin context retained its database,
  localStorage and sessionStorage. Native clears requested only indexeddb.
- The deliberate post-clear native race returned exit 1 and `isError:true`
  with `Native IndexedDB request blocked by an open connection` in 147 ms,
  not the ten-second transport timeout.
- Public cancellation completed in 73 ms; every issued lease retired and
  detached, zero tracked private targets remained, release occurred once,
  the native browser disconnected and the owned remote session was absent.

Healthy, held-clear and blocked-race paths retained user targets and sessionStorage
without reload/close. Cancellation closes the released owned browser intentionally;
this is terminal ownership cleanup, not a workaround for an ordinary restore.

Evidence is `out/issue774/0.1.690/{cf,native}/{report,controls,inputs}.json`,
`cf.log`, `native.log`, and `acceptance.json` with exact harness hashes. Native's
case exercises the unchanged real Node setter; CF-only closing-reader checks
are not claimed as native setter proofs.

No remaining failure was observed in this bounded independent qualification.
Development-account/consumer execution remains with the established owner;
local BROWSER results do not add a deployed verification claim. The issue closing
comment separately records producer development-account evidence. No credentials
are requested or inferred and no new rollout prerequisite is invented.
No repeated eval/clear/full gates or stronger-than-native network/SW guarantees
were added. Root retains overall release monitoring and consumer integration.
