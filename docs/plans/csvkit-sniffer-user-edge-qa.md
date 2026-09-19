# Sniffer user edge QA

1. Inspect the current frozen sniffer and stream profile before reporting bugs.
2. Use in-memory inputs to verify exact character bounds for positive and full
   samples, supplementary characters split across injected decoder chunks,
   mutable producer buffers, and strict decoding of bytes ignored during sniffing.
3. Have an independent agent exercise the registered safe-bash executables with
   exact stdout/stderr/status checks for dialect overrides, raw option rejection,
   multiline inference, warnings and stream lifecycle. Preserve unrelated edits.
4. Run maintained csvkit workspace tests, lint and selected build closure
   uncached, plus focused safe-bash command tests and maintained discovery checks.
5. Record measured results and remaining blockers in docs/csvkit. Only change
   product code after reproducing a failing regression; preserve existing TODOs
   as unqualified cases. Do not stage, commit, push or publish.
