# Integration expectation correction

The current full CSV-family Shell sweep reproduced two failures among 1,695
reported tests: 1,691 passed, two failed, one skipped and one TODO. These were
test-oracle defects, not evidence for changing product behavior. The original
inputs are preserved in the tests and native capture.

The character/byte sampling test used `é;é\nx;y\n`, `-I -f csv -y 5`, and an
explicit six-byte peek profile. Its previous stdin expectation was
`é,é\nx,y\n` with empty stderr and status 0. A frozen native experiment using
CPython `TextIOWrapper(BufferedReader(BytesIO(input), buffer_size=6))` proves
that this profile produces `é,é_2\nx,y\n`, status 0, and Agate's exact duplicate
heading warning. The test now supplies the authenticated warning deployment
path and compares that result, including stderr, for each original chunk
boundary. Its named-input check still suppresses sniff warnings explicitly and
preserves input bytes. The default native pipe capture separately produces the
unsniffed single-column result plus a sniff warning; the custom six-byte profile
must not be reported as the default native pipe behavior.

The NDJSON test used
`{"a":1}\r\n{"b":null}\r{"a":2,"b":3}\n`. Its previous borrowed-stdin
expectation was successful CSV `a,b\n1,\n,\n2,3\n`, empty stderr and status 0.
Frozen native borrowed stdin produces no stdout, status 1, and
`JSONDecodeError: Extra data: line 1 column 12 (char 11)\n`. The identical input
in a named file produces the earlier CSV expectation because named text reads
normalize universal newlines. The corrected test compares both measured cases
and verifies the named VFS input bytes remain unchanged.

`integration-expectation-reference.json` preserves four source observations.
Acquisition rechecked the frozen CPython 3.14.2 executable SHA-256 and nineteen
runtime distribution versions under C/UTC/UTF-8/80x24; it does not replace the
source archive or installed-file manifest authentication. Canonical tests use
MemoryFileSystem and saved observations only. No product source changed for
these oracle corrections, and no assertions were skipped or reduced to make
the sweep pass. The targeted corrected files pass all 79 tests; final refreshed
family/repository checks are recorded in implementation status. Native warnings
and stream peek size are profile-dependent and remain explicitly injected.
