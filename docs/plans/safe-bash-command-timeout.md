# Timeout private command extraction

The private `safe-bash-command-timeout` workspace owns duration and signal
parsing, deadline scheduling, invocation lifecycle, factories and registration.
Safe Bash retains its public root and `commands/timeout` exports, aggregate
inventory and host policy bindings. Canonical arguments, byte values and errors
come from `safe-bash-contracts`; shared executor bindings come from the admitted
IO engine. There is no dependency back to Safe Bash.

The implementation was extracted in `b9634cd075`. This completion audit retains
that implementation and moves standalone host-policy cancellation regressions
into its owning workspace without changing assertions. Shell/worker integration
tests remain in Safe Bash. No default commands, limits or capabilities change.

## Compatibility and verification

- Run the maintained selected timeout build/unit closure, workspace lint and
  package-lint. Verify the private ownership admission test, including its
  failing pre-migration control.
- Run existing timeout duration, scheduler, parent/local cancellation, child
  status, kill-after and cleanup integration regressions.
- Prepare the existing shipping package and pack it. In an isolated consumer,
  execute `safe-packages-timeout.mjs` and compile
  `safe-packages-timeout-types.mts` with strict NodeNext. Verify public factory
  and error identity, byte-valued argv, VFS scripts/pipes, cancellation, explicit
  limits, and collision/replacement without any private workspace installed.
- Keep browser/workerd export conditions and existing runtime qualification.
  The portable cooperative profile rejects unavailable hard escalation; the
  trusted host policy retains responsibility for termination and cleanup.
  This extraction does not introduce a new hard-escalation implementation.

Only the existing parent bundle ships; this workspace stays private. No
standalone publication, external runtime dependency or release job is added.
