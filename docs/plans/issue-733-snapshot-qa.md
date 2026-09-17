# Issue 733: readable Playwright snapshots

## Change and boundaries

- Use public frame locator evaluation of rendered `innerText` for readable page
  content, including headings, in both regular and Cloudflare Playwright. Emit
  quoted text rows without exposing password input values.
- Keep the separate actionable element-handle references and their existing
  lifetime, cancellation, disposal, byte and reference limits. Page text never
  creates references. Hosts without the optional evaluation method retain the DOM
  interaction summary.
- Improve interaction summaries with native associated labels, IDREF labels,
  input-specific roles, checked state and current non-password values. This is
  not a replacement implementation of the complete accessible-name algorithm or
  the full Playwright CLI accessibility tree.
- Run only focused Playwright tests, changed-file lint and focused type checks
  locally. Leave repository-wide gates and publication to GitHub Actions.

## Browser acceptance

Run these steps manually with regular Playwright 1.58.2 and Cloudflare Playwright
1.3.6 through Miniflare's Browser Rendering binding, using real Chromium and the
same exported controller/adapter implementation. Keep temporary dependencies,
output and screenshots under `out/issue-733`, then remove them after inspection.

1. Open a fixture containing a wrapping `Name` label, a `label[for]`, ordered
   `aria-labelledby` references, checkbox, radio, filled textbox, password,
   heading and paragraph. Keep the named controller session for all commands.
2. Snapshot and confirm readable heading/paragraph content and the three names
   in actionable rows, checkbox/radio roles and states, and the filled value.
   Confirm the password is absent from the entire output.
3. Fill the textbox through its emitted handle ref. Snapshot again and confirm
   the current value, then reject the retired ref. Capture and inspect a PNG.
4. Navigate to a page containing only noninteractive text. Confirm it remains
   readable and publishes no actionable refs.
5. Exercise Unicode byte overflow and action-ref overflow. Confirm failure,
   no newly published refs, and disposal of acquired handles.
6. Close the controller and browser and dispose Miniflare. Local Browser
   Rendering emulation is not deployed Cloudflare-service acceptance.

## Delivery

Commit only the fix, regressions and this plan. Push to `main`, verify the remote
commit, close the issue, and monitor both scoped Safe package and main releases
until successful publication. Report local commit, remote delivery and registry
publication separately.
