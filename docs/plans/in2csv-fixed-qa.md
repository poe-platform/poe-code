# Fixed-width implementation and QA

1. Read root/scoped instructions and preserve existing tracked, untracked and
   staged work. Keep Git/export/integration ownership with root.
2. Inspect released `csvkit.convert.fixed`, the frozen reference profile and
   existing implementation. Capture research-only reference observations in
   `out`, then retain specifications and frozen executable observations under
   `docs/specs` and `docs/csvkit`.
3. Reproduce exact stdout/stderr/status failures with memfs differential tests
   before changing code. Validate bare-CR grouping, schema integer-limit errors
   and skip-lines ordering, including a decoding failure before header output.
4. Implement using the existing owned input cursor, CSV reader/writer and
   registered cleanup; preserve raw schema names, codepoint slices and strings.
5. Have a different agent stress the registered safe-bash command. Execute
   `docs/plans/in2csv-fixed-stress-qa.md`, including cancellation and backpressure.
6. Run the selected maintained build closure for `@poe-platform/safe-bash`,
   `npm test --workspace=@poe-code/csvkit`, and domain lint. Run the focused
   safe-bash node tests uncached and lint the new registered stress test.
7. Render actual registered command output with terminal-png into `out`, inspect
   the screenshot, and purge only this task's temporary evidence after use.

Results: the initial regressions failed before their fixes. Fifteen domain
fixed-width cases pass (including a typed SDK invocation, compressed schema,
Latin-1 schema/input, and untouched memfs effects). The domain workspace has
2866 passing tests; one skipped and six todo cases remain explicit blockers.
The selected safe-bash build closure passes. Domain lint and fifteen focused
registered in2csv/ownership/stress tests pass. The new safe-bash test is included
by maintained dynamic discovery; no registry/export changes were needed.

The screenshot showed correct CSV names, Unicode text and retained zero-padded
codes. Its renderer font lacks the emoji glyph; output bytes and codepoint
slicing were separately verified. This renderer limitation is not a product
encoding failure. No screenshot tests or README edits were added.

An intermediate decoding diagnostic experiment was withdrawn after source
inspection established that csvkit reports the selected input encoding, and
the capture environment selected UTF-8. The regression context now matches
the frozen environment; shared diagnostic/codec behavior remains intact.

No commits, pushes or releases are authorized or performed.
