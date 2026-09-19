# Cloudflare unit prerequisites

## Scope

Prepare ignored generated source assets through the existing npm lifecycle before
the Cloudflare workspace unit task. Preserve the profile fixture correction already
on main. No source, generator, workflow, dependency manifest or lockfile changes.

## Implementation

Add `pretest:unit` invoking `node --import tsx scripts/build-browser-run-code-guest.ts`.
The existing build producer prepares both browser codegen and run-code guest assets.
Generated outputs remain ignored and are not committed. Maintained workspace task
selection recognizes lifecycle hooks and retains native npm execution.

## Evidence

Baseline: `0ea58f28ca4bda33034e2bcd25b221e37f89d06b`.
September 19, 2026, UTC:

- Clean-source red: missing `./browser-codegen.generated.js`; one failing suite,
  seven passing suites and 27 passing tests.
- Maintained route: `npm run test:unit --workspace=@poe-code/safe-playwright-cloudflare -- --reporter=dot`.
- Fresh-assets-absent green at 08:07:13: eight passing suites, 33 passing tests,
  exit zero; the log records `pretest:unit` before Vitest.
- Existing npm lifecycle ownership regressions: 44 passing tests.
- Generated source assets and locally supplied declared dependency tooling remain
  ignored; no tracked dependency changes.
- Agent typecheck attempt is not a pass: shared safe-bash build declarations were
  stale and lacked current profile exports. Maintained dependency builds are required
  before qualifying the complete build closure; do not substitute unrelated fixes.

## Delivery

Integrate the manifest and plan as one atomic fix, push directly to main, verify the
remote revision, and monitor GitHub release publication separately. Preserve red
and green evidence before removing the completed HOME worktree.
