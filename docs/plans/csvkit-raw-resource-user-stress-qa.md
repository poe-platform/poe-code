# CSVKit raw resource user stress QA

Exercise the actual Safe Bash plugin with only injected in-memory filesystems,
UTF-8 codec, C locale, clock and noninteractive terminal bindings. Never use a
native csvkit fallback, create fixture files on disk, or query external services.

1. Run `npx vitest run packages/csvkit/src/argv-denial-user-stress.test.ts`.
   Supply custom argument carriers with count or byte metadata above the host
   limit; make payload access fail immediately. Require status 78, empty stdout
   and the exact named budget divergence. Require no input, locale or file effects.
2. Run `node --import tsx --test packages/safe-bash/tests/commands/csvkit-raw-resource-stress.test.ts`.
   Through actual Shell registration, deny argv count and argv bytes before any
   source acquisition; require the same status and diagnostic as the engine.
3. For csvcut, csvgrep, csvformat and csvclean, overrun the input byte limit and
   delay the cooperative named iterator return. Require public execution to stay
   pending until cleanup settles, exactly one return through shell disposal, and
   a later successful invocation with independent counters.
4. For the same four tools, block the first stdout write after a complete
   8192-byte decode window. Require the named producer not to advance until the
   write resolves, then compare exact output, status and source-finalization order.
   The frozen CPython decoding profile intentionally permits lookahead within one
   8192-byte window; transport fragments smaller than that are not separate decode
   boundaries.
5. Run maintained package build/lint and focused unit checks after source fixes.
   Keep full frozen-reference parity, unsupported capabilities, cancellation of
   opaque host work and cases outside this selection explicitly unverified.

Original regression: argv denial returned Safe Bash status 1 with
`shell: line 1: internal error\n`; direct engine invocation threw RangeError.
The selected named-input cleanup and decode-window backpressure cases passed
before any source change. No database or completed file-effect rollback is claimed.
