# Release search cancellation regression

## Failure

Release run `33532389554` for `382458a3e` failed on September 1, 2026.
The workspace test step ran from `16:40:27 UTC` to `17:08:39 UTC`.
The failing outer test was `isolated cancellation and iterator lifecycle checks`
in `packages/safe-bash/tests/commands/search-stress/safety.test.ts`.
Its child process passed eight cases and failed the final case,
`metadata-selected stdin yields during endless empty chunks`: iterator closure
was false after cancellation. The outer five-second deadline did not expire.

## Repair plan

1. Reproduce cancellation arriving before the async generator starts, rather
   than treating elapsed wall time as proof that input consumption began.
2. Start the cancellation timer only after iterator entry. Retain the original
   abort reason, event-loop responsiveness, and iterator-finalization assertions.
3. Exercise startup longer than the original abort interval without adding
   production hooks, weakening assertions, extending timeouts, or changing
   concurrency.
4. Run the isolated lifecycle cases and the containing search-safety suite,
   then push the focused fix and monitor its release through publication.

The twenty-minute release target is not established by this regression repair.

## Local validation

A 50ms in-memory pattern-file read reproduces the old race: eight isolated cases
pass, and iterator closure fails in the final case after 54ms. Starting the 30ms
abort timer inside the generator removes that race while still requiring the
empty-chunk loop to yield to the event loop and finalize the iterator.

All 19 containing search-safety tests pass. Five additional bounded child runs
pass all nine lifecycle cases each. The external five-second deadline, abort
reason identity, no-output assertions, and iterator closure assertion remain
unchanged. No production code or concurrency settings change.
