# Notification history byte bounds

Reproduced an oversized legacy notification being retained after live delivery rejected it. Reconnecting with an earlier Last-Event-ID closed the replay on that retained oversized event, preventing a later valid event from being delivered. The focused test uses in-memory HTTP and two allowed streams to isolate replay retention from stream-admission cleanup.

Measure the full UTF-8 SSE frame before adding history or delivering it. Oversized events close active streams and are not retained; later valid events remain replayable. Apply the same response-size limit to history and live output.

Focused replay regression passes. Full HTTP suite passes: 440 tests across 22 files. Combined client/HTTP scope lint passes. Separately audit immediate stream-admission recovery after response destruction; the first fixture with one stream hit a 409 capacity response and remains a follow-up, not evidence of a history failure.

Follow-up reproduced as fixture error: in-memory ServerResponse lacked destroy(), so the oversized notification path could not close the response. Added the missing destruction lifecycle and reduced the regression to one admitted stream. Immediate replay now returns 200. Full HTTP verification: 435 passed, 5 intentionally skipped, 440 declared cases across 22 files.
