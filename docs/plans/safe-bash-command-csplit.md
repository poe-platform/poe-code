# csplit command workspace

## Ownership and compatibility

Revalidated remote main `6e0997b2ea`: `safe-bash-command-csplit` already owns
options, patterns, splitting, quoting, I/O, budgets and the synchronous evaluator.
Safe Bash retains its public facade and composition. The workspace is private,
uses canonical contracts and lower-level engines, and has no external runtime
dependencies. Existing behavior fixes remain intact.

## Completion work

- Move direct command work-budget and optional-limit tests into the command
  workspace without changing assertions. Keep Shell integration, lifecycle,
  numeric/regex fixtures and native comparisons in Safe Bash: moving those into
  the leaf would introduce a dependency back to the shell.
- Verify root/subpath factory identity, registration collision/replacement,
  canonical byte argv and error identity, cancellation, VFS scripts, pipes,
  regex repetition/suppression, cleanup and explicit limits in isolated packed
  consumers. Run the same portable fixture through browser conditions.
- Check strict NodeNext declarations through public imports, with private
  workspaces absent. Extend the maintained release fixtures, not release jobs.
- Run the selected workspace build, command lint/types/unit checks, existing
  csplit regressions and package boundary gates before delivery.

The extraction predates this audit; no retrospective failing-test claim is made.
This completion changes tests and documentation, not command behavior or defaults.
No CLI presentation change requires screenshot validation. Publication remains
through the existing parent package; the command workspace is never installed
by consumers or independently published.

## Verification

- Selected maintained Safe Bash and command dependency builds passed.
- Command lint, source/test types and all eight leaf tests passed; the 459
  unchanged Shell/behavior regressions passed without skips.
- All 168 integration-input tests and 235 package-safe memfs tests passed.
- Seven package-lint rules passed for the command, parent and direct dependency
  scope; the broad probe reported five asset violations only in unrelated
  github-workflows, terminal-pilot, tokenfill and toolcraft packages.
- Packed public safe-fs and safe-bash tarballs installed outside the repository,
  with no private workspaces. Csplit acceptance passed under Node, browser and
  workerd conditions, strict NodeNext types, and browser/workerd bundles in a
  realm without process, host filesystem or network capabilities. The workerd
  parent graph used the maintained explicit Wasm-module loader.

No full-repository test or release-publication result is claimed. Release waiting
was explicitly waived; remote-main delivery is verified separately.
