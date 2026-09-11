# Issue 659: clarify the host-environment warning

## Scope

Replace only the existing warning sentence in `packages/safe-bash/README.md:273`
with identity-only detection wording: copies are not detected and values are not
filtered. Preserve the existing instruction against supplying secret-bearing
environments. No runtime changes, detection heuristics, or new README content.

## Validation completed on 2026-09-08

- Read the issue report and current implementation. The identity check and
  WeakSet deduplication are explicit in
  `packages/safe-bash/src/shell/env-warning.ts:1`; constructor and execution call
  the helper at `packages/safe-bash/src/shell/shell.ts:107` and
  `packages/safe-bash/src/shell/shell.ts:169`.
- Ran deterministic inline assertions against Shell source using Node 22.22.0,
  MemoryFileSystem, disabled TSX caching, unset NO_COLOR, and the requested
  validation TMPDIR. No source or evidence artifacts were written by the probes.
- Fresh-process warning counts: identical process.env 1; spread copy 0;
  null-prototype copy 0; ordinary allowlist 0; omitted environment 0. Reusing the
  identical object in exec produced no additional warning.
- Commands could read explicitly supplied host variables, including in the
  warned case; the default environment did not inherit PATH. Assertions passed
  without printing host environment values.
- `packages/safe-bash/tests/shell/env-warning.test.ts:22` explicitly expects no
  warning for an equal-valued copy; inspected, not rerun. This is a documentation
  clarification, not a demonstrated security-boundary bypass.

## Delivery

Only the existing README sentence and this validation note are changed for 659.
Root owns review, atomic documentation commits, delivery, and issue closure.
No Git, build, lint, or broad tests were run for this documentation patch.
