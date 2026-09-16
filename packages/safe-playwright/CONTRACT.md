# Injected Playwright agent command subset

`createPlaywrightController({ adapter, limits })` is the SDK command controller.
`virtual-bash/commands/playwright` exposes `createPlaywrightCli` with the same
options, plus `replace` (default false). Both use the same invocation parser and
snapshot engine. Registration is explicit; browsers are acquired only through
trusted injected adapters. Regular and Cloudflare pages share public frame,
locator element-handle, event, keyboard and byte screenshot APIs. There are no
provider-specific command branches or implicit native/ambient browser sources.

## Commands and destinations

| Command | Arguments / options |
| --- | --- |
| `open` | Optional HTTP(S) URL or `about:blank`; `--browser=chromium\|firefox\|webkit`, `--headed` or `--headless` |
| `goto` | Required HTTP(S) URL or `about:blank` |
| `list`, `close`, `close-all` | Existing session lifecycle operations |
| `snapshot` | Optional `--filename=<guest-path>`; otherwise text stdout |
| `click` | Required snapshot ref, such as `e2` |
| `fill` | Required snapshot ref and literal value (including empty string) |
| `press` | Required keyboard key/chord; applies to the selected page |
| `screenshot` | Optional `--filename=<guest-path.png\|jpg\|jpeg>`, `--full-page`; otherwise PNG bytes stdout |
| `tab-list` / `tab list` | Lists zero-based indices, selection, JSON-escaped URLs |
| `tab-new` / `tab new` | Optional HTTP(S) URL or `about:blank`; selects new tab |
| `tab-select` / `tab select` | Required zero-based index |
| `tab-close` / `tab close` | Optional index; closes selected tab if omitted |

All commands accept `--session` / `-s`. Exported `PLAYWRIGHT_CLI_SESSION` selects
the session when the flag is absent; default is `default`. This is the only
exposed environment variable, read from the invocation rather than the host.
`--` ends option parsing so literal values beginning with `-` remain possible.
Repeated/unknown options, invalid arity, non-ref action targets, unsupported
engines/modes and deferred features are rejected before browser effects.

SDK invocations provide `args`, exported `env`, `signal`, an awaited `write(text)`
and optional `registerCleanup`. `writeArtifact(bytes, filename?)` is required for
screenshots and filename output. The shell supplies this destination: it resolves
guest paths relative to the invocation cwd and uses the supplied canonical VFS,
including its symlink/mount semantics. No guest filename goes to Playwright;
`screenshot` returns bytes and the controller copies them before awaited output.
A Buffer-only host API must explicitly convert with `Buffer.from(bytes)`.
Artifact writes use normal VFS overwrite semantics, not atomic publication.

## Snapshot identity and limits

Snapshots are a bounded **DOM interaction summary**, not upstream Playwright CLI
accessibility snapshots or ARIA parity. The engine discovers buttons, inputs,
textareas, selects, links, role-bearing and editable elements across frames,
including CSS selector shadow traversal supported by the injected library. Names
use aria-label, placeholder or text content; full accessible-name calculation,
visibility/state filtering and full semantic role calculation are not claimed.
Each emitted ref binds an actual public element handle in its owning frame.
Identical elements get distinct refs; guest strings are never evaluated as
locators or programs. Plain `ariaSnapshot()` text cannot create usable refs.

Capturing again, navigation events, tab changes and session retirement clear
refs and await handle cleanup. Ref numbering is unique within a controller,
including replacement sessions. Detached nodes, destroyed frame contexts and
handles in replaced documents fail as stale, without locator retargeting or
replay. Externally observed tab additions/removals/reordering also invalidate
refs. Closing the last tab preserves the session for explicit tab management.
Caller-owned pages must expose navigation/close events and public frame element
handles for snapshots. Trusted host work must settle; no opaque host preemption
or guest-code isolation guarantee is implied.

All `limits` values must be positive safe integers and are captured on creation:

| Option | Default | Enforcement |
| --- | ---: | --- |
| `maxSessions` | 4 | Before context acquisition |
| `actionTimeoutMs` | 30000 | Passed to navigation, ref actions and screenshots; keyboard press has no public timeout option |
| `maxTabs` | 16 | Before commanded tab creation |
| `maxSnapshotBytes` | 262144 | UTF-8 summary bytes before publication |
| `maxSnapshotRefs` | 1000 | Acquired handles before publication |
| `maxArtifactBytes` | 16777216 | Screenshot / snapshot artifact bytes before copy or write |

The library materializes screenshot bytes and each frame's handle array before
these limits can inspect them; these are output/retention limits, not browser
memory or transport quotas. Cleanup errors remain visible. Session operations
serialize; sessions can operate independently. Cancellation/registered invocation
cleanup drains owned work and retires an active session; cleanup after successful
transfer preserves it. Disposal drains sessions and acquired handles. The host
retains responsibility for browser ownership, partial acquisition, remote loss,
Worker lifetime, quotas/expiry and reconciliation.

Lease release retires local closure subscriptions even when context closure or
host release rejects. `onClosed` also reports that local retirement; it confirms
neither successful context cleanup nor remote termination. The original cleanup
causes remain observable through the shared release promise.

PDF, video, tracing/download bridges, uploads, native profiles, dashboard,
install/kill commands, and guest `run-code`/evaluation remain unsupported.
`billing` is rejected by this controller; billing types declare periodic live
browser duration including idle only. No timers, collectors or charging exist.

## Qualification scope

Pinned structural source compatibility: regular Playwright 1.58.2 and Cloudflare
Playwright 1.3.6, using the maintained mixed-library bundler fixture. Fake-context
unit tests qualify shared identity/lifetime semantics, and actual safe-bash Shell
invocation covers quoting, streams/statuses, middleware and canonical VFS with
memfs. Regular Chromium was additionally exercised through the product controller
with an explicitly selected local Chrome QA executable. This does not establish
live Cloudflare service, Worker deployment, Firefox or WebKit behavior.
