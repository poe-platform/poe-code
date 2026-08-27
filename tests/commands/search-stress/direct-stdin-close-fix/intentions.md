# Frozen focused intentions

Recorded before source patch or focused execution. Fourteen top-level logical
tests, no native dependency, existing public typed factory/context and Shell APIs.
Original safety wrapper remains byte-for-byte unchanged and separately reported.

1–3. Direct stalled structural stdin: Error, numeric zero, native abort(undefined)
(actual DOMException default, never literal undefined). Exact rejection identity,
one independently callable return completed before command settlement, late next
rejection observed without unhandled rejection or further pulls; release all gates.
4. Per-file input bytes: exact boundary passes, excess fails with existing status
and diagnostic, closes early input without resetting or double-counting bytes.
5. Output bytes shared across stdin and file: exact first write retained, next
write denied; failing cleanup cannot mask the primary quota failure.
6–7. Quiet and max-count stop at the first matching chunk and return exactly once.
8. Natural UTF-8/null-data/no-match completion: exact bytes/status, no return or abort.
9. Explicit file search leaves unrelated stdin untouched, exact bytes/status.
10. Actual Shell already owns structural input and closes before public rejection.
11. Direct borrowed nonreturnable input retains owner control across two commands;
only chunk-boundary fixture continuity, no arbitrary byte handback guarantee.
12. Actual nested Shell invoke with borrowed stdin plus sibling command does not
close parent input early; parent closes once on settlement.
13–14. Direct and public opaque generator: return invoked before rejection,
finally still blocked on controlled next gate; command/public settlement must not
await opaque work. Release gate and await both next and return before fixture ends.

No old expectation/timeout changes, whole 486 run, load generator, independent
holdout inspection, or whole-gate/typecheck claims. At most two focused cause
iterations, preserving raw failures and separating fixture from product defects.
