# csvjoin Python whitespace regression QA

1. Inspect csvkit 2.2.0 `CSVJoin._parse_join_column_names`: its comma-separated
   selectors use Python `str.strip`. Check U+001C–U+001F whitespace and preserve
   U+FEFF, which is not Python whitespace.
2. First execute the new in-memory argv and SDK regressions against the existing
   engine. Compare exact stdout, stderr and status. Record failures before fixing
   the domain command; do not invoke native programs from canonical tests.
3. Replace JavaScript trimming with the existing Python whitespace helper. Run
   the regression and existing csvjoin tests, then maintained uncached csvkit
   workspace test, lint and selected workspace build closure.
4. Execute actual safe-bash csvjoin using injected in-memory input files and
   the control-character selector. Verify the CSV stream is unstyled and output
   remains `k,a,b\nx,A,B\n`. Include it in the root-owned terminal capture and
   inspect the screenshot through `view_image`.
5. Record native evidence honestly: cached CPython/csvkit versions and source
   inspection corroborate the behavior, but a probe without frozen installed-file
   hash qualification is not a passing fully authenticated differential gate.
   Reduce owned logs in out after review.
