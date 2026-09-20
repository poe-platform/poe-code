# Standard Playwright CLI on Cloudflare

User requirement: match the standard CLI's help and behavior; implement every
Cloudflare-supported capability, including durable storage state. No custom
agent-facing syntax. Issue: https://github.com/poe-platform/poe-code/issues/769.

Compatibility oracle: `@playwright/cli@0.1.20`. Provider: `@cloudflare/playwright@1.3.6`.
The oracle has 92 commands, including hidden `config-print` and `tray`. A catalog
entry or matching help is not an implemented or qualified capability.

## Delivery checklist

- [x] Exact global and per-command help; standard flags, `--json`, `--raw`, errors.
- [x] Shared standard response sections, generated files, snapshot links, targets.
- [x] First capability implementation and native Chromium qualification.
- [ ] Remaining supported families implemented and qualified on Cloudflare.
- [x] Isolated `run-code` executes actual JavaScript with Playwright objects.
- [x] Consumer forwards context capabilities and restores complete storage state.
- [x] Owner-scoped KV persistence, standard defaults/overrides, restart and deletion.
- [x] Direct Cloudflare checks verify hydrated Poe, scripts/styles and interaction.
- [ ] Independent security review, maintained checks, verified published archive.
- [ ] Consumer update, ready PR, green CI/reviews, cleanup.

## Current qualification (2026-09-18)

These checks used the local unreleased safe-bash build in an authenticated,
owned temporary Worker on the Poe Dev Cloudflare account. They do not establish
production deployment or publication.

- Native JavaScript evaluation, cookies/localStorage, explicit state save/load,
  console events, and a genuine trace ZIP passed.
- Native hierarchical snapshots and the pinned Cloudflare recorder passed;
  recorder output contains the actual button interaction as Playwright code.
- Policy-owned URL mocks passed through the same URL admission and byte/transfer
  accounting path. A matching mock cannot admit a protected/internal URL.
- Graceful controller replacement restored storage. Forced Durable Object abort
  produced a different instance ID and restored the same saved localStorage.
- Separate owner DOs did not see each other's cookies. Explicit close rejected
  implicit snapshot restoration; explicit open retained saved cookies; delete-data
  cleared the saved profile. Full end-of-run cleanup is required.
- The cloud probe exposed a disposal race (browser closed during final storage
  checkpoint). A reproduce-first regression now gates checkpoint-before-release.
- Production-account probing remains blocked by Cloudflare authentication error
  10000 before Worker/browser allocation; do not claim production qualification.

Additional completed qualification:

- Live `.trace`/`.network`/resource output passed direct Cloudflare recording,
  byte growth after navigation and final file retention after tracing-stop.
- Full CLI `run-code` passed native locators, page mutation, cookie reuse,
  repeated calls, ordinary script errors and new-page creation on Cloudflare.
- A repeated guest disconnect invalidated Chromium emulation while leaving its
  inspector cache unchanged. Clearing the retained CDP metrics cache before
  restoring native settings passed viewport-only and Pixel-device cloud cases,
  including subsequent storage checkpoints and snapshots.
- The code runner's local native suite covers cancellation, deadlines, page and
  output limits, syntax errors, mobile emulation and user viewport/media changes.
  Returned page metadata has an independent 64 KiB strict validation boundary.
- An independent read-only consumer security/lifecycle review found no actionable
  high/medium findings. This does not certify the provider's UDP/WebRTC behavior.

Native configuration/codegen integration passed against Chromium: ordered init
scripts, isolated init-page initialization, scoped test IDs and origin filters,
state-load restoration, native Python/Java/C# action generation, and complete JSON
snapshots with actionable refs, subtree/depth filtering and rounded native boxes.
The Cloudflare native JSON transport separately passed fidelity, byte bounds,
frame bounds and cancellation checks. INI parsing passed focused loading tests
and 837 differential cases against the original parser and configuration coercion.

The integrated Cloudflare configuration probe passed native JSON tree output,
Python action code, custom test IDs, quoted output directories, JSON/INI loading,
configured page scripts, locale/viewport settings, and retained cookies after
controller restart. The init-page-module probe also passed after restoring
guest-created native script registrations after disconnect and separating the host
code-execution budget from individual action timeouts. Duplicate registrations,
last-page closure, ordinary errors, and oversized script metadata have native
regression coverage.

Still pending: final maintained checks, publication, and consumer verification
against the actual public release.

## Complete command inventory

The command families below are implemented with focused regression coverage,
subject to the explicit provider/host constraints in their rows. The qualification
section records completed native and cloud evidence; it does not claim every
command has been individually exercised on Cloudflare or that release is complete.

| Family | Commands | Provider considerations |
| --- | --- | --- |
| Session | open, attach, close, detach, delete-data, list, close-all, kill-all | Hidden owner + agent identity; explicit aliases never select another owner's provider session. Force cleanup applies to owned resources. |
| Navigation/tabs | goto, go-back, go-forward, reload, tab-list, tab-new, tab-close, tab-select | Repeated open replaces the live session; ordinary later runs reuse it. |
| Elements | type, click, dblclick, fill, drag, drop, hover, select, upload, check, uncheck | Issued refs and standard selectors/locators; safe VFS byte inputs. |
| Inspection | snapshot, find, eval, console, resize, run-code | Snapshot visibility/JSON/depth/boxes; eval is browser JavaScript, run-code is host-side Playwright JavaScript in a separate safe runtime. |
| Input/dialog | dialog-accept, dialog-dismiss, press, keydown, keyup, mousemove, mousedown, mouseup, mousewheel | Pending dialog/file chooser/event state belongs to the session. |
| Artifacts | screenshot, pdf, tracing-start, tracing-stop | Real artifacts in VFS; live Cloudflare trace files and final retention have direct cloud evidence. |
| State/cookies | state-load, state-save, cookie-list, cookie-get, cookie-set, cookie-delete, cookie-clear | Load replaces state; CF lacks public setStorageState, use safe context replacement. Standard save excludes IndexedDB unless requested. |
| DOM storage | localstorage-list, localstorage-get, localstorage-set, localstorage-delete, localstorage-clear, sessionstorage-list, sessionstorage-get, sessionstorage-set, sessionstorage-delete, sessionstorage-clear | Standard storageState excludes sessionStorage; avoid silently changing that contract. |
| Network | requests, request, request-headers, request-body, response-headers, response-body, route, route-list, unroute, network-state-set | Bounded collectors; mocks may not remove or bypass mandatory host egress policy. |
| Locator/page tools | generate-locator, highlight, webmcp-list, webmcp-call, video-show-actions, video-hide-actions | Use real page/injected APIs; overlays do not establish video support. |
| Recording/view | recording-start, recording-stop, show | Record actual browser interactions; provider live view requires authenticated ownership, not an exposed bearer URL or fake dashboard. |
| Configuration | config-print, install, install-browser | Configuration/skill files use VFS; native browser installation is provider-managed. |
| Provider/runtime constraints | video-start, video-stop, video-chapter, pause-at, resume, step-over, tray | CF explicitly lacks video and Playwright Test runtime; OS tray unavailable. Report accurate execution errors without changing standard help or faking these features. |

## Persistence and boundaries

Core compatibility now has focused and native-browser evidence for:

- Standard device/mobile context emulation, bounded VFS JSON/INI config and storage
  state loading, canonical action/navigation/settle defaults and ordered init scripts.
  Explicit idle timeouts survive checkpoints and do not expire running commands.
- Native `initPage` default exports execute through the isolated host, configured
  test-id attributes remain scoped to each page, and configured origin filters
  retain mandatory host routing. Context replacement reinstalls these settings.
- Global/local/environment configuration precedence, generated output directories,
  oldest-file retention with current-command protection, snapshot boxes, console
  thresholds and resolved configuration output have focused regression coverage.
- Native action generation supports TypeScript, Python, Java and C# through a
  trusted provider hook; `none` suppresses code sections. The native oracle leaves
  literal JavaScript code snippets unchanged across languages. Locator generation
  remains JavaScript syntax as in the original CLI.
- Canonical locator expression parsing with native round-trip validation, without
  evaluating expression strings in the host runtime.
- Native hierarchical snapshots, scoped actionable refs, search, generated
  locators, subtree/depth/boxes and persistent highlight removal. The native test
  exercises the pinned Cloudflare snapshot interface fallback. Explicit JSON uses
  the actual native accessibility tree, preserving full names and native metadata;
  filename output follows the original CLI's YAML artifact behavior. Capture
  failures retire the lease before another session can reuse the browser.
- Cold owner-scoped session listing without browser allocation, explicit-close
  suppression of resume and force retirement of owned sessions.
- VFS workspace/skill installation using unmodified CLI0.1.20 assets and a no-op
  install for a provider's already available Chromium browser.

Remaining core compatibility gaps requiring explicit qualification:

- Arbitrary external init-page module/package imports and host MCP service fields
  are not implemented; unsupported settings fail explicitly. Default-export and
  CommonJS init-page functions execute in the isolated runtime.
- Cloudflare1.3.6's native accessibility tree predates the newest `invalid` and
  `ariaHidden` properties. JSON preserves the available native tree semantics;
  those newer properties require a provider update rather than guessed DOM state.
- Full `list --all` workspace/metadata semantics and exact plain diagnostics.
- Remote browser output cannot truthfully include a native daemon PID; current
  output omits that field instead of inventing one.
- Attachment requires the standard registered browser-server or CDP broker,
  which this host does not expose with authenticated ownership. Normal open
  sessions are not attachment targets. `attach` validates the standard target
  conflicts and missing-target errors; `detach` preserves normal open sessions.
- Dashboard `show` requires the CLI's local HTTP daemon and OS app host. Desktop
  tray and Playwright Test stepping likewise require facilities absent here.
  These are host constraints, not claims that Cloudflare browser pages lack APIs.
- Native action annotations require `Page.screencast.showActions/hideActions`,
  independent of active video; these work on providers exposing the real APIs.
  Cloudflare1.3.6 lacks those methods. Native video recording and persistent Chrome
  profiles are explicitly unsupported by that provider, as are non-Chromium engines.
- Live trace artifacts and isolated run-code have authenticated cloud evidence;
  the final integrated candidate still requires release and consumer verification.

The consumer's trusted user + agent selects its Durable Object. Default session
name is the agent ID; standard explicit session and environment overrides apply
within that owner. KV versions must be immutable and the DO authoritative for
current state/deletion. Account for propagation misses, concurrent writers,
cancelled/failed publication, expiry, old-version cleanup, and worker restart.
Persisting cookies/localStorage/IndexedDB is distinct from reattaching to a live
browser or restoring arbitrary DOM/JS heap state.

Mandatory HTTP egress enforcement remains installed for every tab and context.
Issue #758 documents the remaining UDP/WebRTC isolation limitation; its closure
does not establish provider enforcement. Do not claim full network isolation.

## Existing release fixes

0.1.676 publication and archive verification completed in GitHub run
35339413950. It includes the hidden noscript snapshot fix (#762), upload-buffer
retirement (#760), and publication verification improvements (#761). It does
not implement this expanded capability requirement. #746 and #763 remain owned
by the other ongoing resolver; do not modify their implementation here.
