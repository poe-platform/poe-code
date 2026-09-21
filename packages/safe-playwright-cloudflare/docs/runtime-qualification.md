# Published adapter native fixture hosts

Use esbuild for local native Worker fixtures. On hosts affected by Bun/Miniflare
runtime recreation failures, run each browser scenario in a fresh subprocess,
awaiting runtime disposal and child exit before starting the next scenario.
Keep cold restart and storage assertions inside those scenarios; process
isolation is not permission to omit them. No minimum Bun version is established
by this qualification.

Native Node fixture hosts must preload
`tests/browser-process-lifetime.setup.mjs` before loading Miniflare (Node's
`--import` option). The native Vitest configuration installs it automatically.
Pinned Miniflare launches detached Chromium with SIGTERM handling disabled;
normal `dispose()` alone cannot retire browsers after a host is killed. The
preload gives an independent IPC guardian ownership of each matching detached
Browser Rendering process group. Browser exit or host disconnection retires
that group. A private working directory identifies double-forked crashpad
helpers through `lsof`, so their cleanup excludes other browsers. The directory
is removed after helper retirement. These hosts require `lsof` on PATH.
This protection applies to these native test hosts, not deployed Cloudflare
Browser Run or arbitrary consumer hosts. Windows native hosts are unsupported.

Run `npm run test:native --workspace=@poe-code/safe-playwright-cloudflare --
tests/browser-process-lifetime.test.native.ts` from the repository root for the
fresh process-lifetime contract. It launches Miniflare's pinned Chromium and
checks group absence within five seconds after normal disposal, setup failure,
SIGTERM, SIGKILL, and SIGKILL during startup. It needs local Chromium prerequisites
and permission to launch macOS browser helpers.

## Qualification on September 19, 2026

Profile: macOS 15.7.7 ARM64, published `@poe-platform/safe-bash@0.1.701`,
`@cloudflare/playwright@1.3.6`, Miniflare `4.20260708.1`, esbuild `0.25.10`,
Worker compatibility date `2026-07-08`, `nodejs_compat`, and local Browser
Rendering binding. Imports resolved through the installed public
`@poe-platform/safe-bash/playwright/cloudflare` export, without source aliases.

Every completed cycle rebuilt the fixture, created a new Miniflare runtime,
acquired a native Chromium lease, clicked a button, evaluated its changed DOM,
captured a structured snapshot, asserted the exact 129-frame rejection message,
released the lease, checked that the page closed, released again, dispatched a
successful JSON response, and awaited runtime disposal. Networking and native
JavaScript APIs remained enabled.

| Bun           | esbuild, five cycles in one host                            | esbuild, five fresh subprocesses   | Bun.build, first build              |
| ------------- | ----------------------------------------------------------- | ---------------------------------- | ----------------------------------- |
| 1.3.11 stable | Broken pipe after three completed cycles; repeat after four | 5/5 passed, successful child exits | Failed resolving unused peer assets |
| 1.3.12 stable | 5/5 passed, successful host exit                            | 5/5 passed, successful child exits | Failed resolving unused peer assets |
| 1.4.2 stable  | 5/5 passed, successful host exit                            | 5/5 passed, successful child exits | Failed resolving unused peer assets |

The first Bun 1.3.11 host stopped progressing after Workerd reported
`miniposix::write ... Broken pipe; fd = 3` and was terminated explicitly. The
repeat also stalled and was terminated by its 90-second external supervisor.
Incomplete cycles are failures,
not successful browser assertions. Completed cycles also emitted peer WebSocket
`Network connection lost` diagnostics during session shutdown; these diagnostics
were retained, and assertion/exit success does not imply a silent transport.

Bun.build with `target: 'node'` failed before runtime creation on all three
versions, resolving `./loader` in peer `server/electron/electron.js` and
`./chromium/appIcon.png` in peer `server/launchApp.js`. A browser-target attempt
on 1.3.12 failed identically. The same installed package resolved and ran through
esbuild. This demonstrates a Bun bundler/peer asset integration incompatibility,
separate from runtime recreation; it does not establish missing safe-bash assets.
Do not hide it by substituting empty modules or dropping native assertions.

The reported consumer `Unseekable`, `EISDIR`, misattributed relative imports and
`ENOENT` failures were not reproduced by this fixture. The Workerd pipe failure
was reproduced twice on 1.3.11. These observations do not prove a resolver root
cause, qualify every consumer module graph, or certify all releases newer than
1.3.12. Bun canary, published 0.1.697, consumer-specific storage/compaction suites,
and deployed Browser Run were not exercised in this run. Earlier consumer
results in issue 110 remain separate evidence.

## Reproduction and artifact identity

Follow the [manual qualification plan](../../../docs/plans/cloudflare-published-runtime-qualification.md).
External/native checks must run fresh. The portable shell remains independent
of Cloudflare; no runtime dependency, networking restriction, quota or disabled
JavaScript API was introduced.

Installed package npm integrity:
`sha512-N4aU1NmjNZAVM1L2lcv3CESpOAZKveQVUaEjuPe8YjRNKaYu6lIgLtWKnrnXm+mZA84caIxIFWF8X2EFUlX8PA==`.
Package baseline upstream commit: `fa65748d115ea9ac76155b4c80e04ce6dc7d8ca8`.

Pinned macOS ARM64 Bun executable SHA-256:

| Version | SHA-256                                                            |
| ------- | ------------------------------------------------------------------ |
| 1.3.11  | `1d77af7bfd811aebb7d37bec496a5eed14fe227ded3ab7866d2f39786e8107b6` |
| 1.3.12  | `39e644cea4e6db24a3af36013695655d6f789b4b98f1f13bacb882ac6e5c3c18` |
| 1.4.2   | `35d20dd0263e5c950194434b925454fdfa9ba6e4467da960410fa05b08a7a5b5` |

## Sustained upload investigation on September 21, 2026

Issue 245 followed consumer PR 15084 at
`6c6d4101981c9c67f4a2279754f6e4380bbfb97a`. Its first CI attempt
([job 106484931751](https://github.com/poe-internal/poe2/actions/runs/35645488374/job/106484931751))
returned HTTP 500 with `Owned browser release failed` during sustained uploads;
subsequent close-all also failed. The top-level message did not identify which
cleanup operation failed. This observation does not establish a cause.
The same-SHA retry
([job 106490714925](https://github.com/poe-internal/poe2/actions/runs/35645488374/job/106490714925))
passed that exact test in 1.80 seconds, compared with the failed attempt's
17.42 seconds; the retry build job succeeded. No source change separated
these attempts. This does not prove a shared cause with other CI failures.

The exact installed `@poe-platform/safe-bash@0.1.713` with
`@cloudflare/playwright@1.3.6` completed five synthetic native Chromium sessions:
one serial session, then two rounds with two concurrent sessions. Each session
clicked a button that sent 33 sequential 2 MiB POST bodies and waited for its
completion element before releasing its public adapter lease. The local HTTP
server received all 165 uploads (346,030,080 bytes), every Worker response was
HTTP 200, and the Browser Rendering session list was empty after release.
Native shutdown emitted trusted `Network connection lost` events, but these
did not fail release. This was concurrent synthetic session load, not the
consumer's full CI workload or its exact persistence integration.

The current checkout's maintained native session-capacity fixture also passed
its shell-driven 33-upload sequence, exact 66 MiB byte assertion, explicit
close-all, and empty session-list assertion. Host: Linux x64, Node 22,
Miniflare `4.20260708.1`, compatibility date `2026-07-08`, `nodejs_compat`.
This container could not launch sandboxed Chromium; a temporary host-side
launcher added `--no-sandbox` only to matching synthetic fixture browsers.
The detached-browser ownership guardian remained enabled. These results do
not qualify Chromium sandbox behavior or deployed Browser Run.

The original release failure remains unreproduced. Release messages now name
failed cleanup phases and phases pending at the existing five-second deadline,
so a consumer retaining only `String(error)` can distinguish provider deletion,
storage control, private transport, public connection, and upstream closure.
Original aggregate errors and physical close confirmation remain intact. No
admission guard, transport budget, test deadline, or release deadline changed.
