# Independent registered fixed-width stress QA

Exercise the actual safe-bash `in2csv` registration with in-memory filesystem
inputs. Do not launch native csvkit, create physical fixture files, or modify
captured reference data from canonical tests.

1. Run `node --import tsx --test packages/safe-bash/tests/commands/in2csv-fixed-stress.test.ts`
   from the checkout root with fresh uncached execution.
2. Compare stdout, stderr and exit status exactly. Check schema and named input
   bytes remain unchanged and that no extra VFS files appear.
3. Confirm borrowed CRLF terminators remain visible to negative slicing. A
   `-2` start and length `1` on `ab\r\n` slices CR, then strips to an empty
   field, rather than selecting `b` after premature normalization.
4. Confirm a bare CR in borrowed stdin remains within its original LF-delimited
   physical record. The writer normalizes the retained embedded CR after slicing
   and quotes the multiline field. Check borrowed NUL retention separately from
   named LazyFile iteration's NUL filtering.
5. Verify supplementary Unicode characters count as one position, fields may
   overlap or occur out of order, zero and negative lengths preserve Python
   slicing, and huge integer endpoints clamp without arithmetic precision loss.
6. Verify only the first schema data row chooses one-based positions. Later
   zero/negative starts follow that mode and `--zero` does not change it.
7. Root integration owner registers the exact canonical test pathname in
   `packages/safe-bash/scripts/integration-inputs.test.mjs` and runs maintained
   build/test/lint checks for the final source. Scoped stress success does not
   certify other csvkit commands or unmeasured cases.

Initial reproduction: four tests executed; codepoint/slicing and first-row mode
tests passed, while CRLF negative slicing and borrowed bare-CR grouping failed.
The failing output selected `b`/`d` after normalization and split the bare-CR
record into separate rows. These are concrete regression evidence for root's
converter change. Re-run after that change before recording acceptance.

Final independent replay: all five tests passed after root's converter fix.
The fifth test pauses an awaited row sink, cancels the invocation, checks the
original cancellation reason, and verifies the registered/finally cleanup closes
the borrowed iterator exactly once without another producer pull. Its input
chunk matches the codec's bounded 8192-byte admission prefix; an initial
two-byte producer incorrectly expected zero codec read-ahead and was corrected
to test row backpressure rather than changing the established codec contract.

A separate research-only run with the frozen CPython executable confirmed exact
CRLF negative-slice, Unicode/overlap/huge-index, and one-based-plus-`--zero`
stdout/stderr/status expectations. Root's separate frozen measurements confirmed
bare-CR grouping and borrowed/named NUL effects. Canonical tests contain only
in-memory injected inputs and no oracle subprocess calls.
