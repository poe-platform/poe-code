# Review harness attempts

All original and new runtime cases executed once. No timeout, input or assertion
change and no retry-to-green. Nine product controls and five native counterparts
passed their first run; original five failed at their unchanged 1200ms gate.

One post-execution summary extraction failed before producing its summary:
`SyntaxError: Expected ',' or '}' after property value in JSON at position 169`
in `summarize.mjs:11`. Node TAP diagnostics escape backslashes for presentation;
the summary parser initially tried to parse that escaped presentation directly.
The parser now removes that single TAP presentation escaping layer. Raw stdout,
stderr, JSON transcripts and original assertions are unchanged. This is an
evidence-reader correction, not a product/test result or execution retry.

GNU full-page and exact Node 22.22.2 documentation opens yielded no usable tool
content. Official GNU indexed text and official Node 22-series documentation
were retrieved using web.run as recorded in primary-sources.md. Exact runtime
authentication comes from local executable hashes/version output, not docs.
