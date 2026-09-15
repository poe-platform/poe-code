# Stdio UTF-8 validation

An in-memory main-Node transport QA check reproduced byte 0xff inside a tool argument being replaced by U+FFFD by readline, after which the tool executed with the altered value. The client already uses a fatal streaming TextDecoder. Evidence: /tmp/mcp-server-stdio-utf8-byte-qa-red.log; the synthetic handler received {value: U+FFFD} and the no-execution assertion failed.

After the current broad verification checkpoint completes, add fast in-memory server transport regressions for invalid bytes, truncated multibyte sequences, valid split UTF-8, and reader/lifecycle cleanup. Validate raw byte segments before forwarding them to readline, preserve the existing line byte bound before decoding segments, and flush the decoder on input completion. Map decoder failures through normal transport failure cleanup rather than throwing out of stream transforms. Preserve legitimate string/surrogate chunk accounting and established CR/LF behavior.

Six fast in-memory red regressions reproduced invalid lead/continuation bytes, overlong encodings, encoded surrogates, incomplete characters at delimiters, and incomplete characters at EOF. The server now validates bounded segments with a fatal streaming decoder before forwarding them to readline and flushes it at EOF. All 44 input-limit, backpressure, and cancellation checks pass; altered arguments never execute and transport cleanup pauses/unpipes input.

The same byte-level audit reproduced replacement in HTTP request parsing and client SSE response parsing. Five HTTP body regressions and four SSE regressions failed before the fixes. Fatal UTF-8 decoding now rejects those bytes through established parse-error/reader-cleanup paths. HTTP body plus maintained server checks pass 300 cases; SSE plus maintained request lifecycle/provenance checks pass 32 cases. Valid individual-byte fragmentation retains accented and supplementary characters.

Current logs: /tmp/mcp-stdio-utf8-tests-green.log, /tmp/mcp-http-body-utf8-green.log, /tmp/mcp-client-sse-utf8-green.log. Full source gates, builds, and lint follow these focused checkpoints. No README additions or delivery claims are made.
