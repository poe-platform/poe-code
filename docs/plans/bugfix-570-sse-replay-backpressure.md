# #570: SSE replay backpressure

## Validation and policy

September 4, 2026. Replay used raw `res.write` while live notifications and
keepalives already checked `writableLength` against `maxStreamBufferBytes`.
A bounded public-transport regression queued two notifications and reconnected
with five buffered bytes under a four-byte configured threshold. The stream
remained open before the fix; the red test failed before production changes.

Route replay through the existing live-GET writer. Preserve its pre-write
comparison: equality permits a write, and the next write sees any newly buffered
bytes. This is not a hard post-write byte ceiling and does not change history
capacity, event IDs, Last-Event-ID selection, or cleanup registration.

## Tests and delivery

- The regression requires the already-over-threshold replay to close before
  writing, then reconnects at the exact threshold and receives both stored
  events. This also verifies cleanup permits reconnection and rejection does
  not consume history.
- Existing live-event, keepalive, replay, and lifecycle tests remain controls.
- Original red evidence: `/tmp/kamilio-570-red.log`; one failure, 38 unselected
  tests, not counted as passes.
- Implementation is one call-site change in `http-transport.ts`; test coverage
  stays in `production-readiness.test.ts`. No README, config, dependency,
  event-retention, or generic writer-policy changes.
- Full gates and push remain separate. Close only after verified remote-main
  delivery, and monitor publication independently.

## Focused result

The complete HTTP package directory passes 399 tests in 14 files, uncached;
log: `/tmp/kamilio-570-green.log`. Package-configured source-only no-emit
TypeScript passes; log: `/tmp/kamilio-570-source-types.log`. This is not a
claim that the existing test tree is free of independent type diagnostics.
