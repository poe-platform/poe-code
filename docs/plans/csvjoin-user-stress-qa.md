# csvjoin user-facing shell edge QA

Exercise the registered literal `csvjoin` with explicitly injected UTF-8 codec,
C/UTC locale, deterministic clock and terminal bindings. Use in-memory files
and streams; no native subprocesses, network, database or LLM calls occur in
the canonical test cases.

1. Run `node --import tsx --test packages/safe-bash/tests/commands/csvjoin-user-edge.test.ts`.
2. Join quoted filenames, including a filename identical to `--right`, with
   clustered short options and the `--` terminator. Redirect the result into
   the virtual filesystem; compare exact status, output bytes and unchanged
   source-file bytes.
   Also reproduce both root-validated original differentials through the shell:
   empty equal-valued columns omit the first value-equal column, and repeating
   stdin as two inputs returns the original closed-file ValueError with no table.
3. Join stdin to a named file using different key names. Verify exact table
   serialization and a single source finalization.
4. Request version information and reject an outer join without columns.
   Compare exact stdout, stderr and status; assert neither operation acquires
   stdin or a named input stream.
5. Configure an input-byte limit admitting each input individually but rejecting
   their total materialization. Verify explicit status 78, exact diagnostic,
   zero table output and unchanged source files.
6. Block the first injected stdout write. Verify no later row arrives until
   it resolves, then verify exact row chunks and the shell's buffered result.
7. Abort with numeric zero during the first output write. Verify the rejection
   retains that falsey reason, no subsequent row is written and input closes once.
8. Dispose the shell while a cooperative named-file iterator awaits `next()`.
   Verify registered cleanup calls `return()` once, releases the pending read,
   and completes before disposal settles.
9. Run root-selected maintained uncached workspace build/test/lint checks after
   integration. Preserve unrelated changes and staging; do not commit or push.

The initial independent run passed all seven integration-capability cases. Two
additional regression cases reproduced both root-validated source differences
against the prior built package: empty input columns emitted `v,k,w` instead of
`v,k,j`, and repeated stdin incorrectly returned success. These regression
cases then passed against the rebuilt domain workspace; the final independent
run passed all nine tests.
The maintained `npm run typecheck --workspace=@poe-platform/safe-bash` route
also completed with exit 0 and cleaned its temporary consumer fixtures. Its
type-only result does not establish runtime acceptance for those consumer groups.
The initial backpressure test
incorrectly assumed an injected external sink disables `Shell.exec`'s buffered
stdout result; correcting the test expectation preserved the existing shell
contract. Product fixes remain owned by the root integration agent.

These cases qualify cooperative in-memory shell integration only. Arbitrarily
uncooperative injected work, real adapter deployment, every encoding and locale,
and full csvkit executable-suite parity remain unmeasured. The join intentionally
materializes all inputs and results under explicit byte, row, column and work
bounds; these tests do not establish streaming-join behavior.
