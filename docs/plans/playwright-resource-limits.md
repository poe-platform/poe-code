# Playwright resource-limit issue queue

Fix and release open issues #737, #738, #741, #742, #743 and #744 independently.
Issue #731 is explicitly excluded.

## Popup admission (#738)

- Reproduce page-created overflow and delayed popups between commands.
- Subscribe to context page events before creating the initial managed page.
- Retire only the owning session on overflow and check counts at command boundaries.
- Preserve exact capacity, replacement after tab close, cleanup and alias reuse.
- Run focused tests and the real Chromium CLI integration check:
  `node --test packages/safe-bash/tests/integration/playwright-popups.test.mjs`.
  `PLAYWRIGHT_TEST_MODULE` selects the installed Playwright module file URL;
  `PLAYWRIGHT_BROWSERS_PATH` selects its installed Chromium; optional
  `SAFE_BASH_TEST_ROOT` selects a built package root ending in `/`.
- The native test covers click-driven and delayed popup creation, exact capacity,
  replacement, sibling-session isolation, retirement and explicit reopening.

## Remaining issues

- #743: unmatched URL globs on name-restricted filesystems; preserve actual-access errors.
- #741: confirmed external browser closure racing with lease retirement; retain real errors.
- #742: bound snapshot strings, attributes and handle acquisition before CDP transfer.
- #744: bound screenshot production before CDP transfer, not just artifact writing.
- #737: verify the transport failure and require bounded, honest cleanup semantics.

Use failing regressions first, atomic commits, focused local checks, GitHub
publication, installed-artifact verification and a fresh issue-queue scan.

## Snapshot extraction (#742)

- Retain selected nodes in a non-node browser-side capsule using frame evaluation.
- Admit aggregate refs and UTF-8 rendering before any content crosses CDP.
- Avoid locator evaluation and node-handle extraction during capture, including
  protocol descriptions containing unbounded id/class/other attributes.
- Acquire native handles only for requested actions; retain stale-ref and deferred
  disposal semantics. This does not bound subsequent native action traffic (#737).
- Run `tests/integration/playwright-snapshot-limits.test.mjs` with the same runtime
  environment as the popup test. Check 40 MiB body, label and value rejection;
  huge unrelated id/class/data attributes; recovery and retained node identity.

## Screenshot production (#744)

- Measure bounded numeric geometry with page evaluation, without locator handles.
- Admit conservative CSS-pixel raster limits and pass an explicit fixed clip so
  later resizing or high DPR cannot enlarge the native capture.
- Preserve exact encoded-byte validation, cancellation and owned VFS writes.
- Run `tests/integration/playwright-screenshot-limits.test.mjs` with the native
  runtime environment above. Check tiny success, encoding-overhead rejection,
  2048/4096 full-page refusal before capture, DPR, resize races and recovery.

## Cloudflare transport retirement (#737)

- The pinned local runtime is `@cloudflare/playwright@1.3.6` with
  `miniflare@4.20260708.1`. Payload expansion, not raw POST size alone, can exceed
  the 32 MiB CDP WebSocket message cap; the local proxy does not forward its error.
- Add an optional acquired-resource `interrupt` hook. Start it alongside context
  closure, drain both operations, and always await the existing host release hook.
- Use public `acquire` then `connect` for an owned Cloudflare session. Connected
  browser close disconnects the local transport; keep remote deletion separate.
- Qualify the real CLI with 512 KiB zero / 8 MiB printable controls and the 6 MiB
  zero payload, preserving native timeout diagnostics and settling disposal.
- Record local disconnection, original-operation settlement, deletion response and
  session-list absence separately. Do not claim process exit from the latter two.
- Local binding DELETE support does not establish deployed binding support or a
  hard process-termination deadline. Production hosts must provide and qualify
  their own out-of-band session-retirement implementation; no ambient credentials,
  private SDK transport access, provider-wide killing or raised message cap.

### Maintained local qualification

Run `node --test packages/safe-bash/tests/integration/playwright-cloudflare.test.mjs`
with `SAFE_BASH_CF_RUNTIME_ROOT` pointing to an isolated installation of the pinned
Cloudflare/Miniflare packages and `esbuild@0.25.10`, with native Chromium prerequisites.
Optional `SAFE_BASH_TEST_ROOT` selects a built or installed package's module root
(for npm artifacts, `dist/safe-bash/`), as a filesystem path or file URL.

This esbuild-based fixture explicitly uses compatibility date `2026-07-08`,
`nodejs_compat`, and the `EVAL` unsafe-evaluation binding. It qualifies this local
profile only. Trying the issue's `2025-01-01` date and its four flags with this
bare-esbuild fixture fails at startup on unavailable `node:os`, before any browser
test. That is not a passing legacy-profile test or evidence that the consumer's
Wrangler-polyfilled build fails. Preserve the distinction; deployed and legacy
consumer qualification are still outside this local result.

The fixture checks the real CLI, original native context-close settlement, local
disconnect, service deletion response, independent session-list absence and shell
disposal. Release HTTP requests receive one shared five-second cancellation signal;
this is cooperative transport cancellation, not forced preemption of an arbitrary
host promise. The outer native test also cancels its dispatch on its own deadline.
