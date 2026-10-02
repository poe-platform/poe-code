# apply_patch command ownership

The private `safe-bash-command-apply-patch` workspace owns parsing, matching,
resource accounting, VFS changes, publication and synchronous evaluation. Safe
Bash retains its public export and registration/composition responsibilities.
The command spelling is `apply_patch`; the workspace name is not a public import.

The implementation was extracted in b9634cd075. Preserve subsequent behavior
fixes, default inventory, replacement policy, VFS confinement and conditional
publication. Multi-file preflight failures must not publish staged changes;
publication itself retains the existing provider capability semantics, without
claiming a transaction. Limits remain configurable with existing defaults.

Completion work:

- Move anchor and blank-context unit regressions to the implementation owner,
  preserving every assertion. Keep Shell race regressions in Safe Bash.
- Add the missing unit prerequisite edge (`^build`) reproduced by a failing
  maintained graph test; verify private admission, the dependency/build graph, canonical
  contracts and thin adapter with the maintained boundary tests.
- Add isolated packed-consumer coverage for public imports, registration,
  byte argv identity, pipes, VFS scripts, cancellation, multi-file failure and
  configured limits, plus strict NodeNext declarations.
- Run selected workspace build/unit/type/lint and packaging policy checks.
  Use the generic parent packaging route; no independent package publication.

No command output or help change is intended. The package README uses public
Safe Bash imports. Temporary verification output is removed after use.
