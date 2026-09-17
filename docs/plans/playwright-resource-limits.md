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
