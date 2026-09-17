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
