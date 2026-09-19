# Fixed-width user edge QA

1. Inspect released `csvkit.convert.fixed` and the frozen CPython 3.14.2,
   csvkit 2.2.0 and Agate 1.14.2 profile. Authenticate the interpreter hash
   before research execution. Measure the streaming converter using StringIO
   schema, data and output; retain exact outputs/errors/status in
   `docs/csvkit/in2csv-fixed-user-reference.json`. This reference measures the
   converter, not standalone CLI global-option behavior.
2. Replay all 73 cases with both argv and typed SDK. Split UTF-8 input at every
   byte, including supplementary codepoints. Compare stdout, stderr and status
   exactly; confirm memfs schema bytes and file inventory remain unchanged.
3. Execute the separate agent's registered-command procedure in
   `docs/plans/in2csv-fixed-user-stress-qa.md`. Verify consumer closure,
   cancellation/backpressure and reused producer-buffer ownership.
4. Run uncached domain workspace tests/lint and the selected maintained
   safe-bash workspace build closure. Verify literal discovery assertions and
   safe-bash typechecking. Lint the independently authored shell test.
5. Render actual registered `in2csv` output with terminal-png under `out`,
   inspect the image, then remove only this task's temporary evidence.

Results: all 73 new converter observations match argv and SDK. Huge positive
and negative endpoints, negative/zero lengths, CRLF and unterminated records,
astral characters, Python strip whitespace, Unicode decimal digits, invalid
integer separators, duplicate headers and schema error evaluation order pass.
No product defect was validated; engine code was left unchanged.

The complete domain workspace run passed 2939 tests. Its one skipped and six
todo cases remain blockers, not passes. The selected safe-bash build closure
and domain lint passed. Twenty-two focused registered fixed/ownership tests
passed, including sixteen independently authored user cases. Dynamic discovery
checks and independent test lint passed. Screenshot inspection confirmed
readable Unicode names and preserved zero-padded codes while `-l`, `-H` and
`--zero` retain their measured fixed-converter effects.
The maintained safe-bash typecheck passed source/tests, historical and source
consumers, and all 26 current consumer groups; expected negative consumers
failed compilation as required. Typechecking is not runtime acceptance.

Unqualified verbose tracebacks, corrupt compression diagnostics and absent
injected codec/compression capabilities remain the existing explicit blockers.
This finite cohort does not certify every edge case or the full command suite.
No README edits, staging, commits, pushes or releases were performed.
