# Issue #578: aggregate retained string storage

## Validated problem

On `42d9dba27`, `ValueScope.hold` and `ValueStore.publish` omit strings from
retained-value accounting. An in-memory shell regression publishes distinct
60-, 61-, and 61-byte ASCII values under `maxExpansionBytes: 128`; it succeeds
when the regression expects `ShellLimitError`. This confirms the report without
the original large-memory workload.

## Implementation scope

- Extend the existing execution-wide `ValueArena` budget to retained strings.
- Charge UTF-16 payload storage per retained string binding, state copy, and
  saved local value. Equal string contents do not prove shared backing storage;
  conservative accounting avoids undercounting independently created values.
  Preserve the existing identity-based sharing of byte carriers.
- Preserve ordinary tiny-budget text execution without byte-carrier metadata costs.
- Admit ownership before publication, roll back failed publication, and release
  ownership on overwrite, unset, scope exit, and execution cleanup.
- Transfer saved ownership during restoration without fresh allocation or
  cancellation checks.
- Preserve saved positional ownership while a sourced script temporarily replaces
  its arguments; publish replacement arguments through the existing value store.
- Publish invocation/middleware environment updates through the scalar owner so
  the updated values cannot silently invalidate their budget reservations.
- Keep initial host-provided environment values outside this execution-created
  value accounting, as before. Do not add a new public limit or change array budgets.

## Validation and delivery

Run focused retained-value and byte-value tests, including alias sharing, failed
publication, cloning, local shadow restoration, and repeated execution. Then run
appropriate shell regressions and maintained lint/build checks. Commit only this
issue's files, push main, close the issue after validated delivery, and monitor
its releases separately. Preserve unrelated staged cut-command changes.

The initial patch passed 91 focused tests and the selected `virtual-bash` build.
Independent review then reproduced source-positional and middleware-environment
bypasses. The first broader run reported 1761 passes and five failures; that run
does not qualify the final candidate. Guarded lint was explicitly stopped before
revising the patch and must be rerun.

The second broader run reported 1768 passes and five failures. Three were caused
by invoking package-relative tests from the repository root; rerun from the
package directory. Two exposed cancelled prefix restoration retaining the inner
value. Independent review also reproduced superseded middleware overlays retaining
saved string quota. Address both lifecycle paths before final validation.

Final validation after the lifecycle corrections:

- 121 focused tests passed; independent review passed 14 targeted tests and a
  repeated middleware-overlay scenario, with no remaining concrete findings.
- All 1,982 shell and value-contract tests passed from `packages/safe-bash`,
  with no failures or skipped tests.
- `npm run build:workspaces -- --workspace=virtual-bash` passed for the selected
  workspace and its safe-fs build dependency.
- `npm run lint:eslint` completed successfully: 9,617 configured files linted,
  zero errors, zero warnings, and all 25 receipt boundaries processed.
- `git diff --check` passed for the issue's owned changes.

The existing cancelled-prefix restoration assertions remain unchanged. Saved
scalar ownership now drains after admitted work, and superseded middleware
overlays explicitly release their saved values.
