# Find command ownership and verification

## Scope

Keep `safe-bash-command-find` private and bundle it through the established
Safe Bash exports. Preserve default inventories, unlimited default quotas,
explicit directory limits, physical/logical symlinks, expression ordering,
byte-valued formats and literal child invocation. No host process fallback.

## Ownership

- `find.ts`: directory traversal, memory fast paths and synchronous evaluator.
- `expression.ts`: asynchronous expression compilation, lazy boolean actions,
  traversal configuration, reference metadata and per-invocation status.
- `find-format.ts`: byte format compilation and cooperative buffered output.
- `invocation.ts`: canonical child argv substitution and bounded exec batching.
- `safe-bash-io-engine`: shared pattern algorithms and directory admission below
  both the shell and command. Canonical identities remain in `safe-bash-contracts`.
- Safe Bash keeps public adapters, standard registration and real Shell integration
  tests; the private package owns direct command tests, including option regressions.

## Verification

1. Run the expression characterization before extraction; it must fail because
   the expression module is absent, then pass after extraction.
2. Run maintained selected find build/unit routes, source/test typechecks and lint.
3. Run retained Shell find printf, time/delete, deleted-entry and directory limit
   regressions; preserve all assertions when moving direct option tests.
4. Run command boundary and packaging tests and package-lint boundary rules.
5. Prepare and pack existing shipping libraries with `scripts/package-safe.mjs`.
   Install those tarballs outside the checkout, without private workspace packages.
   Run `safe-packages-find.mjs` and strict NodeNext `safe-packages-find-types.mts`.
   Check byte argv across VFS scripts/pipes/exec, canonical brands/errors,
   cancellation, symlinks, collision/replacement and finite directory admission.
6. Confirm the same fixture bundles with browser/workerd conditions. No command
   output/help changes are intended; existing output assertions remain authoritative.
7. Rebase on remote main, commit, push, verify ancestry, then clean the worktree.
   Release publication is a separate result.
