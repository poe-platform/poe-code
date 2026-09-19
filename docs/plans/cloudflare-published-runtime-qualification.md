# Published Cloudflare fixture runtime qualification

Manual QA for issue 110. Execute against an installed public package, never a
source alias. Keep scratch fixtures, dependencies and logs under `out`; remove
them after recording the results. This is a local Workerd/Chromium qualification,
not a deployed Browser Run certification or a portable-core change.

1. On macOS ARM64, create an isolated npm consumer under `out` with
   `@poe-platform/safe-bash@0.1.701`, `@cloudflare/playwright@1.3.6`,
   `miniflare@4.20260708.1` and `esbuild@0.25.10`. Install pinned Bun
   1.3.11, 1.3.12 and 1.4.2 binaries separately; record versions and hashes.
   Allow Miniflare to install its Chromium prerequisite. Do not alter networking
   permissions or disable browser JavaScript APIs.
2. Create a Worker fixture in that consumer importing `node:assert/strict` and
   `createCloudflarePlaywrightAdapter` from
   `@poe-platform/safe-bash/playwright/cloudflare`. Its fetch handler acquires a
   Chromium lease using `env.BROWSER`, a unique acquisition ID, a session name,
   `headless: true` and an explicit AbortSignal. In a `try/finally`:
   - Create a page; set content to a Save button whose onclick changes its text
     to Clicked. Click through `getByRole`; assert `page.evaluate` reads Clicked.
   - Call `lease.captureSnapshotJSON(page, { signal, timeoutMs: 15000,
maxBytes: 1048576 })`; assert its JSON contains Clicked.
   - Replace content with 128 iframes, each containing a button. Assert snapshot
     rejection has exactly `Browser snapshot frame limit exceeded` (the main
     frame makes 129). Keep this assertion on every cycle.
   - Await `lease.release()`, assert `page.isClosed()`, return `{ ok: true }`.
     Await release again in finally to exercise idempotent cleanup.
3. For each Bun version, execute five cycles in one process. Rebuild the fixture
   with esbuild on every cycle: `bundle: true`, `write: false`, `format: 'esm'`,
   `platform: 'node'`, `target: 'es2022'`, and externals `node:*`, `cloudflare:*`,
   `browser-user-code.js`. Do not redirect package imports through source plugins.
   Create a new Miniflare with `modules: true`, the generated script,
   `compatibilityDate: '2026-07-08'`, `compatibilityFlags: ['nodejs_compat']`,
   `cf: false`, `browserRendering: { binding: 'BROWSER' }`. Dispatch fetch,
   assert status 200 and exact JSON `{ ok: true }`, then await disposal before
   rebuilding. Record completed cycles and the failing stage. Supervise a stalled
   process externally; a timeout or unfinished cycle is a failure, never a pass.
4. Repeat the same five scenarios as five fresh Bun subprocesses per version,
   one build/runtime/disposal cycle each. Await successful child exit before
   starting the next. Preserve every Worker assertion, including the frame
   classification and release checks. This tests process isolation without
   weakening browser behavior.
5. Separately attempt a first build with `Bun.build` using `target: 'node'` and
   the same externals, then `target: 'browser'` if relevant to the consumer.
   Record build logs before constructing Miniflare. A first-build failure is
   distinct from a runtime recreation failure. Do not externalize arbitrary
   missing peer assets or invent replacement modules to get a green build.
6. Classify errors by stage and resolved path. Missing assets under safe-bash's
   installed export are package candidates; failures resolving unused peer
   Electron assets before runtime creation are bundler/peer integration issues.
   Workerd Broken pipe after successful cycles is a host lifecycle failure;
   it does not establish a missing package asset. Repeat intermittent failures
   before deriving a runtime floor. Record diagnostic output even when assertions
   pass. Keep earlier consumer observations separate from this reproduction.
7. Update the adapter qualification record with exact scope, outcomes, tool
   versions and remaining uncertainty. Recommend fresh subprocesses when runtime
   recreation is unstable; do not claim all newer Bun releases are qualified.
   Remove only task-owned scratch files after recording evidence.
