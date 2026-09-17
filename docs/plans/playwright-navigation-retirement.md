# Issue 736: navigation-safe snapshot retirement

- Reproduce disposal during click, fill and session-scoped custom actions.
- Clear stale refs synchronously on navigation; retain handles until actions settle.
- Drain deferred disposal on success, failure and cancellation without disabling
  Playwright navigation waiting or blocking a handler's explicit tab selection.
- Run focused Playwright tests and the real Chromium integration regression.
- Push the atomic fix to main, close the verified issue and monitor publication.

## Real-browser regression

Install `playwright-core@1.59.1` in an isolated temporary directory and install its
matching Chromium. Set `PLAYWRIGHT_TEST_MODULE` to that module's `index.mjs` file
URL and `PLAYWRIGHT_BROWSERS_PATH` to the isolated browser directory. Run:

```sh
node --test packages/safe-bash/tests/integration/playwright-navigation.test.mjs
```

The test uses built output by default. `SAFE_BASH_TEST_ROOT` optionally selects
another built or unpacked package root (a file URL ending in `/`). Both the
standard controller and virtual CLI must complete open, snapshot, fill, form
submit, another snapshot and screenshot in the same named session. The next
document holds an image response; the main response is also gated to verify that
click retains Playwright's normal navigation waiting rather than returning early.
No external page is contacted and screenshots stay in the virtual filesystem.

For visual QA, inspect the final Saved page and its Continue button in a captured
screenshot; verify that the original form is no longer displayed. Browser
integration is an explicit external-runtime check, not part of fast unit tests.
