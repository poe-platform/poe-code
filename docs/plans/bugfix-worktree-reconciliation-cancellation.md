# Worktree reconciliation cancellation (POE-006)

## User-facing defect

The SDK accepts an AbortSignal for managed and automatic worktree reconciliation
but drops it before spawning the reconciliation agent. The core already passes
the signal to both reconciliation and cleanup-nudge callbacks; the SDK bridge
omits it in either phase. Cancelling a run therefore fails to reach an active
reconciliation/cleanup agent through these paths.

## Scope

- Forward the existing borrowed phase signal through both SDK spawn bridges.
- Preserve and verify the core's existing signal forwarding in both phases.
- Preserve omission when no signal was supplied, agent/model/thread options,
  successful reconciliation, and the existing failed-run cleanup policy.
- Do not introduce a new cancellation status, reclaim registry locks, change
  retry policy, alter agent supervision, or modify unrelated worktree findings.
- Cancellation remains cooperative: custom agents must observe their signal.
  These changes do not terminate an arbitrary uncooperative injected callback.

## Regression strategy

Use the real SDK and worktree package with memfs, fake Git, and injected agents.
Exercise manual reconciliation, automatic worktree execution, and optional
worktree execution in both reconciliation and cleanup-nudge phases. Cover
in-flight cancellation, successful completion with a signal, absence of a
signal, and a pre-aborted manual reconciliation request.

The cancellation cases require the exact supplied signal to reach every agent
phase, preserve the caller's abort reason through a cooperative agent, retain
the worktree contents, and avoid claiming successful completion. Every paused
fixture is released in cleanup so a failing assertion cannot leave a test hung.

## Validation and delivery

1. Record the new regression failures before changing production code.
2. Forward the signal at the two SDK boundaries and rerun the tests.
3. Run adjacent worktree/workflow tests, the normal build, root unit tests, and
   compiled public-SDK probes across supported Node runtimes.
4. Capture a dry-run reconciliation CLI screenshot as an adjacent visual smoke
   check; cancellation correctness comes from the behavioral tests.
5. Commit only this plan, its regression test, and the SDK production file,
   using normal hooks. Preserve the existing four local fixes and all drafts.
6. Record push/release status separately. The shared native publication gate is
   already blocked by unavailable historical test binaries; do not bypass it or
   count this local commit as a delivered release.

## Red/green record

- The 19 real SDK/core regressions initially report 13 failures and six passing
  no-signal controls. All failures concern the missing agent signal.
- Adding signal forwarding to the two SDK bridges makes all 19 cases pass;
  the focused SDK/worktree suite passes 124 tests across four files.
- An initially proposed core cleanup edit was unnecessary: checking committed
  source confirmed that phase already forwards the signal. The core is unchanged.
- The same regressions against the actual `poe-code@13.0.10` public bundle report
  13 failures and six passing controls, confirming the currently released defect.
  The first artifact-helper import was too broad; using the compiled registry
  reader directly avoids unrelated unbundled workspace imports.
- The normal build and production typecheck pass. The new regression file also
  passes a focused strict TypeScript check with the existing ambient asset types.
- The rebuilt public SDK passes all 19 cases on each of Node 18.18.2, 20.20.0,
  22.22.2, and 24.14.0: 76 compiled checks. Its bundle hash remains unchanged
  after the visual smoke command rebuilds the workspaces.
- The full root unit suite passes 29,011 tests with 43 configured skips across
  1,105 passing files and three skipped files. This is additional validation,
  not a replacement for the blocked native-workspace publication gate.
- `npm run screenshot-poe-code -- --dry-run worktree reconcile cancellation-check
  --agent codex` succeeds. Its capture is readable and retains the explicit
  preview without a false success message. The command performed 69 uncached
  workspace builds; it does not exercise a real reconciliation agent.
