# Playwright supported subset qualification

## Scope

Qualify the same public element-handle snapshot engine for regular Playwright
1.58.2 and Cloudflare Playwright 1.3.6. This is an injected agent command subset,
with a DOM interaction summary, rather than upstream accessibility-tree parity.
No private snapshot APIs, guest code execution, native guest command fallback,
or billing runtime are included.

## Execution steps

1. Run the Safe Bash Playwright unit and typecheck commands. Run the exact
   safe-bash Playwright plugin tests through actual Shell invocation, with fake
   injected contexts and memfs. Verify literal quoting, byte streams, middleware
   denial, PIPESTATUS, canonical VFS writes and failures, capacity, cancellation,
   dynamic DOM identity, frames, and stale refs after navigation/tabs/reopen.
2. Build the explicitly selected Safe Bash workspace closure. Compile the
   maintained compatibility fixture against the pinned regular and Cloudflare
   dependencies in an isolated evidence directory. Verify consumed public page,
   frame, element handle, event and byte APIs are concrete, with explicit Buffer
   conversion for Buffer-only inputs.
3. With an explicitly selected local Chrome executable as a QA oracle, use the
   product adapter/controller/snapshot engine with regular Playwright. Create
   identical buttons, a text input and an iframe through trusted QA setup. Capture
   refs and act on the second identical button and the frame button. Replace a
   referenced node and verify its ref fails without retargeting; navigate and
   verify all old refs fail. Save and inspect a screenshot, then purge evidence.
4. Inspect ad hoc terminal screenshots of actual supported command output,
   stale-ref diagnostics and tab listings. Do not add screenshot tests.
5. Run the maintained root ESLint wrapper and safe-bash integration input runner
   tests. Report scope and any actual failures without weakening guards.
6. Live Cloudflare service behavior requires a configured Worker browser binding.
   Without that binding, record structural API qualification and fake-context
   semantics separately from live service verification. Do not invent a pass.

## Evidence storage

Use `/out`; this environment mounts it read-only, so use repository `out/` as
already qualified in the parent topic plan. Purge only this task's temporary
files after verification. Preserve other captures and source edits.

## Results on 2026-09-16

- TDD: new command/ref tests first failed for missing actions/engine, last-tab
  management, invalid or mutable limits, cancellation and lost cleanup errors;
  implementations were added only after concrete failures.
- `npm run test:unit --workspace=@poe-platform/safe-bash`: 33 passed.
- Exact safe-bash Playwright CLI and adapter test files: 31 passed, including 10
  actual-shell tests. No files or LLM queries were created by these unit tests.
- `npm run typecheck --workspace=@poe-platform/safe-bash`: passed.
- `npm run typecheck --workspace=@poe-platform/safe-bash`: source/tests, 26 maintained public
  consumer groups and required negative consumers passed (compile-only).
- `npm run build:workspaces -- --workspace=@poe-platform/safe-bash`: passed the maintained
  selected seven-workspace build closure; final Playwright chunk rebuild passed.
- Maintained integration-input runner test: 109 passed, including literal
  Playwright CLI test discovery. This is not full safe-bash unit execution.
- Maintained compatibility fixture: concrete page, frame, element-handle and
  Buffer types compile against the pinned regular and Cloudflare libraries.
  Inspected Cloudflare's published wrapper: public locator elementHandles and
  element-handle evaluate/click/fill/dispose are explicitly supported.
- `npm run lint:eslint -- --format=json`: passed the guarded root wrapper.
- Regular Playwright with explicitly selected local Chrome: second identical
  button clicked independently, quoted input filled, frame button clicked,
  screenshot PNG returned through SDK byte output, replacement/navigation old
  refs rejected, and tab new/list/select/close passed. Browser/context disposed.
- Browser screenshot inspected: first button remains Same, second reads Clicked
  second, input retains quoted message, iframe reads Frame clicked. Ad hoc
  terminal screenshot inspected: refs, tab indices/selection and stale-ref
  guidance render correctly through actual product Shell invocation.
- Live Cloudflare Worker binding/service, Firefox and WebKit remain unverified;
  this task establishes the shared injected subset, not deployed-provider parity.
- Temporary dependencies, source consumer, PNGs and capture evidence under this
  task's repository out directory were purged. No README, billing runtime,
  commits, pushes or releases were changed/performed.

## Follow-up review on 2026-09-16

- Reproduced an external-tab invalidation failure through actual Shell invocation:
  an injected context returning its live mutable tab array let a stale ref click
  after an external tab change. The new regression and existing external-tab
  test both failed before the fix.
- The controller now retains copies of tab observations at every acquisition,
  inspection, creation and closure boundary. No new abstraction or provider
  branch is required; SDK and CLI share the correction.
- Focused Playwright unit tests: 33 passed. Exact safe-bash Playwright CLI
  and adapter tests: 32 passed, including the new mutable-array regression.
- Selected Safe Bash workspace build and typecheck passed.
- Safe-bash typecheck passed source/tests, 26 maintained public consumer groups
  and required negative consumers. Integration-input runner tests: 109 passed.
- Guarded root `npm run lint:eslint -- --format=json` completed with status 0.
- Inspected an ad hoc terminal screenshot of actual Shell output: an externally
  added tab makes the old ref return status 1 with snapshot-again guidance;
  tab-list shows both tabs and a fresh snapshot ref clicks with status 0.
- Temporary screenshot purged. No README edits, commits or pushes performed.

## Tab-capacity edge-case review on 2026-09-16

- Reproduced through actual Shell invocation: `open` on an injected context
  already at `maxTabs` returned success and created an additional page. The new
  regression failed with exit status 0 where status 1 was required.
- The shared controller now checks existing context pages before page creation
  or navigation and retires the acquired lease when capacity is unavailable.
  The regression also verifies explicit reopen after capacity becomes available
  and rejection of `tab-new` at the limit.
- Safe-playwright maintained unit tests: 33 passed. Exact safe-bash Playwright
  CLI and adapter tests: 33 passed. Both maintained package typechecks passed,
  including safe-bash's 26 current consumer groups and expected negative cases.
- Selected Safe Bash workspace build and guarded root ESLint passed.
- Inspected a terminal screenshot of actual Shell output: the tab-limit
  diagnostic, status 1, closed session, zero created pages and one released
  lease were clear. Temporary screenshot and lint output were purged.
- No live Cloudflare binding was available. No README edits, billing runtime,
  commits or pushes were performed; unrelated edits were preserved.
