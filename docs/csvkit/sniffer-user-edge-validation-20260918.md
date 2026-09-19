# Sniffer user edge validation

Reviewed the current implementation against the existing frozen CPython 3.14.2
and Agate source contract. This review reproduced no product defect; product
code was left unchanged. Added four in-memory LazyInput tests and seven
independently authored actual-shell tests, with a literal discovery assertion.

The new cases verify exact positive/full sample character bounds, decoder chunks
splitting a supplementary character, mutable producer buffer ownership, strict
decoding of invalid bytes ignored by the sniff sample, manual quote/delimiter/tab
precedence, ambiguous and multiline records, all five raw executables rejecting
`-y` before input acquisition, multibyte file-versus-stdin thresholds across chunk
boundaries, unchanged VFS input, cleanup on sample refusal, and warning identity
reset/suppression across invocations. Shell cases compare stdout, stderr and
status exactly. Tests use injected in-memory inputs and MemoryFileSystem.

Measured checks in this dirty worktree:

- Csvkit maintained workspace tests: 27 files, 1586 passes, five TODOs.
- Csvkit maintained lint and source/test typechecks: passed.
- Selected maintained csvkit build closure: passed, including office-package.
- Independent focused shell edge file: seven passes, zero skips/TODOs;
  its focused ESLint check passed.
- Complete focused safe-bash csvkit command family: 114 passes, zero skips/TODOs
  through `node --import tsx --test packages/safe-bash/tests/commands/csvkit*.test.ts`.
- Maintained safe-bash discovery checks: 109 passes; focused discovery-file
  ESLint passed.
- `git diff --check`: passed.

No product output or visual design changed, so no additional screenshot was
generated for these test additions. Existing qualification limits in
`docs/specs/csvkit-sniffer.md` remain: other encoding profiles, live pipe/TTY
scheduling, positive sniffing after decoded stdin advancement, warning deployments
without identity, and hard regex elapsed-time bounds are unqualified. The five
encoding TODOs are not passes. This review does not qualify all csvkit behavior
or the full repository gate. No staging, commit, push or publication occurred;
unrelated changes were preserved.
