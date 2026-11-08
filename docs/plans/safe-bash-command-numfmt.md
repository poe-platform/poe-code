# Numfmt private command extraction

## Ownership and compatibility

At main `6982edd926`, `safe-bash-command-numfmt` already owns the command and its
unit regressions. Safe Bash owns default composition and public adapters. Retain
all current factories, option precedence, byte carriers, diagnostics, registration
policy and explicit resource limits. Current default limits are Infinity.

## Implementation

- Keep the workspace private and use canonical `safe-bash-contracts` imports.
- Separate binary precision/scaling, byte presentation/diagnostics, field and unit
  selection, bounded output padding, and record buffering inside the workspace.
- Retain existing command tests and shell-level integration regressions unchanged.
- Document only public Safe Bash imports; do not publish a standalone package.
- Use the existing admitted workspace build and packaging rules without new
  dependencies, capabilities, exports or default registrations.

## Verification

- Failing boundary characterization before moving the numeric/selection code.
- Workspace build, unit tests, lint and strict source/test types.
- Safe Bash numfmt regressions, including precision, padding quotas and limits.
- Memfs package rewriting and isolated packed public consumers: root/subpath
  factories, byte argv, canonical errors, VFS scripts/pipes, cancellation,
  collision/replacement, and strict NodeNext declarations.
- Package-lint and browser/workerd public import qualification.
- Commit, rebase over current main, push, verify remote ancestry, then close.
  Publication is separate and is not required for this delivery.
