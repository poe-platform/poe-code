# Extract dos2unix into a private command workspace

Issue: 998. Ownership revalidated at main
`2ce65ebb46d30fdc955e85f233fba0f18d6508a3`: the implementation was in
`packages/safe-bash/src/commands/line-endings`; neither requested workspace
existed. Preserve the existing byte/UTF-16 profile and all public imports.

## Implementation

- Move command option parsing and execution into private
  `safe-bash-command-dos2unix`. Keep the existing direction-aware handler and
  both command factories together so unix2dos shares the same command behavior.
- Move conversion, encoding detection, limits, file information, IO lifecycle
  and staged publication into private `safe-bash-line-ending-engine`.
- Keep Safe Bash's line-ending module as composition and static compatibility
  exports. Do not add commands, export conditions, native execution or defaults.
- Move the existing filesystem output budget and direct write helper to
  `safe-bash-contracts/filesystem-output-budget`. Preserve its singleton map,
  cleanup ownership, cancellation and shell budget binding through static exports.
- Move diagnostics, yield checkpoints and their shared signal helpers unchanged
  into the same canonical contracts owner. Preserve existing compatibility paths
  and keep unrelated in-progress query/text extraction work separate.
- Move the direct acquisition, lifecycle and safety tests intact into the command
  workspace. Keep Shell, native snapshot, publication, byte-path and composition
  tests in Safe Bash. Add encoding tests to the shared engine.
- Deep merge workspace manifests, lockfile, private admission and maintained
  build/test declarations. Use generic private artifact packaging. Ship only
  through existing Safe Bash/poe-code surfaces, with neither standalone releases
  nor unpublished imports required by consumers.

## Verification

The boundary test was added before implementation and failed with
`ERR_MODULE_NOT_FOUND` for `safe-bash-command-dos2unix`.

- Run the selected workspace build closure and command/engine/contracts tests,
  source/test typechecks and lint.
- Run Safe Bash's maintained line-ending and filesystem output suites and its
  integration-boundary checks. Preserve every moved assertion.
- Extend the maintained memfs packed graph test and isolated consumer fixtures
  to cover the extracted command and engine, both directions, canonical arguments,
  error constructors, file budgets, cancellation, VFS scripts and registration.
- Verify strict NodeNext declarations and Node/browser/workerd consumers without
  private workspace packages or source resolution.
- Run full maintained build, unit and lint routes for the shared contract move,
  package-lint, and inspect their completion evidence.
- Review the final diff, commit the issue's changes, push to main and verify the
  commit is contained in remote main. Close only after every requirement passes.
  The user explicitly does not require waiting for release publication.

Temporary logs are kept in the checkout's `out/issue-998` and removed after use;
the host's absolute `/out` is unavailable to this user (mkdir denied and sudo
requires a password). No generated evidence belongs in this plan directory.
