# csvjoin user edge QA

1. Replay the hash-locked CPython 3.9.6 reference under an owned `out`
   directory; authenticate installed csvjoin against its recorded source hash.
2. Capture exact bytes/status for empty-side joins in all modes, keys outside
   the first column, three-input traversal, invalid selectors, equal-valued
   columns, repeated stdin, BOM and line numbers. Store frozen observations in
   `docs/csvkit/csvjoin-user-edge-reference.json`.
3. Run those observations using in-memory domain capabilities. Reproduce
   mismatches before modifying product code. Preserve original observations.
4. Fix verified Agate column-equality omission and stdin-close discrepancies
   within csvjoin. Recheck all domain tests and maintained workspace lint.
5. Have a different agent exercise actual safe-bash invocation and resource
   contracts. Run the selected maintained safe-bash build closure, focused
   shell tests, registration checks and relevant lint/type checks.
6. Render the changed empty-table/equal-column behavior with the maintained
   screenshot route and inspect the image. Record limitations honestly and
   remove only owned temporary reference and screenshot artifacts.
