# soffice invalid-limit boundary QA

Execute against the current candidate:

1. Run command workspace lint and unit routes. Reject negative, fractional,
   NaN and infinite work limits through CLI and SDK; output capability getters
   must remain untouched, the result must be a typed limit failure, and the
   registered cleanup must remain callable.
2. Run the memory-VFS soffice wiring fixture and maintained safe-bash build closure.
3. Stage with package-safe under out/command-soffice-limit. Run the soffice runtime
   and strict NodeNext declaration fixtures against generated public packages.
4. Inspect the public command runtime/declaration import closure for leaked
   unpublished packages. Purge task-owned generated evidence.

## Receipt — 2026-09-20

The added regression failed with `SofficeError: invalid limit` before the fix.
Budget initialization now belongs to the invocation error handler. Invalid limits
return exitCode 1/status limit without acquiring output capabilities or emitting
unaccounted diagnostics. Cleanup registration still precedes acquisition.

- Command lint, production/test typechecks: passed.
- Command unit route: 52 passed, zero failures/skips.
- Memory-VFS shell wiring: two passed; network mocked and untouched.
- Maintained selected @poe-platform/safe-bash build closure: passed, including
  postbuild. This is not a full repository build/test/lint receipt.
- Generated public-package runtime and strict declaration fixtures: passed.
  Initial fixture setup lacked the declared public safe-fs dependency; runtime
  and declaration attempts failed resolution, then passed after setup correction.
- AST import/export closure: 24 runtime/declaration files inspected; no leaked
  private module specifiers. The sole external reference is the declared public
  first-party @poe-platform/safe-fs/core contract boundary. The consumer has no
  private command package linked. Whole-artifact dependency independence is not
  established by this scoped closure inspection.

No help/version/diagnostic text changed; no visual screenshot run was required
for this budget-only change. Existing Markdown QA steps above were executed.
Office conversion, actual browser/workerd/Bun cells, hostile realm isolation,
checkpoint/replay and native exit parity remain unverified or unsupported.
No rendering engine, stdin conversion, layout corpus or PDF standards check was
performed. The pinned source findings and blocked pre-main native attempts remain
source evidence only. Broad repository gates were not run for this focused fix.

Unrelated working-tree changes were preserved. No local commits, remote-main
push, release or standalone command publication was performed.
