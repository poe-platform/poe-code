# Playwright client abilities

## Goal

Expose the complete pinned Playwright CLI command surface, including browser,
storage, network, WebMCP, recording, installation and debugger abilities. The
client chooses implementations. Do not decide availability from provider names,
silently install software, evaluate guest code in the host, or advertise an
unimplemented command.

## Contract

- Maintain the original pinned CLI syntax/descriptions and option metadata in a
  public command catalog. Generate argument admission and help from that catalog.
- An explicit abilities map is authoritative: only its commands and declared
  options are executable and visible in global help. Missing abilities are not
  advertised. Command help can explain an unavailable known command honestly.
- A client supplies command handlers, optionally with limitations and selected
  supported options. All known commands can be implemented, including host-only
  commands; the framework never implements those with implicit host effects.
- Preserve the current adapter as a compatibility preset when no explicit map is
  supplied. Explicit maps can select existing built-ins individually.
- Support both independently owned client backends and handlers borrowing the
  controller's retained browser session. Borrowed handlers share serialization,
  cancellation, snapshot refs, tab selection, and resource retirement.
- Expose structured arguments/options, cancellation and bounded virtual-file
  reads/writes identically through SDK and CLI. Client implementations own their
  privileged effects; no native-path or arbitrary-evaluation fallback.
- Keep help browser-free. A configured capability is a client assertion, not a
  claim that every Cloudflare or Playwright deployment implements it.

## Verification and delivery

1. Reproduce missing callback dispatch and static help with failing tests.
2. Independently cover every pinned command and flag, exact capability selection,
   CLI/SDK parity, unavailable-command denial, input validation, VFS I/O, session
   reuse, cleanup, cancellation, output failures and resource limits.
3. Exercise representative browser/storage/network handlers against real regular
   Playwright and the local Cloudflare runtime; distinguish deployed acceptance.
4. Have a separate agent stress/review the implemented boundary, as required by
   the package instructions. Integrate concrete findings with regression tests.
5. Run focused maintained tests/lint/types and inspect screenshots of generated
   help for minimal, mixed and full client configurations. Avoid full local gates.
6. Make atomic Conventional Commits with explicit paths; push to main. Monitor
   GitHub release workflows and verify published npm artifacts, not just pushes.

No README additions are included without user permission. Document the public
contract separately alongside this plan.

## Implemented qualification

- Added the immutable 92-command catalog, authoritative client ability maps,
  declared option admission, conditional help, session-borrowing callbacks and
  bounded CLI/SDK virtual-file transport. Documented the public contract in
  `docs/PLAYWRIGHT_ABILITIES.md`.
- Captured independent command/option metadata from `@playwright/cli@0.1.20`,
  whose exact Playwright dependency is `1.64.0-alpha-2026-09-14`. The global
  presentation fixture remains the independently pinned original reference.
- The focused suite passes 125 tests. This includes dispatch of all 92 commands
  and their pinned flags, plus 35 independent execution-boundary stress tests.
  The reviewer reproduced 13 failures before fixing retained helper admission,
  draining and cancellation. Controller regression tests also cover external
  tab closure and cleanup that must not block browser release.
- Selected SafeFS and Safe Bash build closures passed. Strict changed-scope
  checks and the public consumer fixture passed with regular Playwright 1.58.2,
  Cloudflare Playwright 1.3.6 and concrete Node declarations. No full local unit
  or repository-wide lint gate was run.
- Real Chromium and the Cloudflare local runtime (Miniflare 4.20260730.0) passed
  18 capability-workflow groups: configured help, retained sessions, snapshots,
  selector/button clicks, typing, browser evaluation, resizing, VFS uploads,
  cookies, local/session storage, state export, request capture, routes/unroute,
  binary response artifacts, offline/online, reload, PNG screenshots and PDF.
  These were explicit client implementations, not claims of 92 built-ins or
  deployed Cloudflare acceptance. The first probe incorrectly passed a function
  expression as a noninvoked Playwright string; only the probe was corrected to
  invoke it in the browser. Both backend reruns passed. Cloudflare logged its
  known connection-loss event during browser shutdown after the checks.
- Captured and inspected full, selected-capability and command-specific help
  screenshots from the actual shell plugin. Temporary captures/probe dependencies
  stay under `out/playwright-abilities` and are removed after release verification.

## Release verifier follow-up

Feature commit `11205a7c1` reached remote main. Scoped run `35166484415` passed
builds, package checks, installed-tarball checks and all three publish steps for
0.1.641, but failed only registry verification: the SafeFS version endpoint
returned 404 on all twelve attempts over approximately two minutes. A separate
npm lookup still returned 404 for Safe Bash shortly afterward. Publication is
not considered verified on the basis of the publish-step exit status alone.

Increase the existing verification window to sixty ten-second attempts, bound
individual requests with connection/transfer timeouts, and cap the step at fifteen
minutes. Keep exact version assertions and failure on exhaustion. Validate this
workflow-only correction with `npm run lint:workflows`, not unit tests, and commit
it separately before monitoring the resulting release through registry acceptance.
