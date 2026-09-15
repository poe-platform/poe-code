# HTTP unused response ownership

Seven red in-memory stream regressions reproduced unread GET 405/404/missing-or-unsupported-type bodies, DELETE successful/405 bodies, and expired legacy POST session bodies never being canceled. Cancel each unused response before returning or ending the session. These ownership checks plus maintained lifecycle checks passed 28 cases.

A separate red race reproduced a valid GET SSE body arriving after disposal opening a reader that can never be reached by the already-completed disposal cleanup. Check disposed state immediately after GET fetch settlement and cancel late bodies before interpreting status or opening readers.

Four red media-type cases reproduced substring detection accepting application/jsonp, text/event-streaming, and types mentioned only in parameters. Compare the normalized actual media type before parameters; retain case-insensitive JSON/SSE parameterized types. Ownership/lifecycle/media regressions pass 36 cases in /tmp/mcp-http-response-ownership-media-current.log.

Five additional red OAuth cases reproduced original unauthorized bodies and provider-response clones remaining uncanceled on retry, provider refusal/throw, challenge errors, and metadata-discovery errors. A main-Node probe verified cancellation of both Response.clone tee branches settles and cancels the source once. Cancel the clone after the hook settles, then cancel original bodies when retrying or throwing; preserve originals needed for normal error processing. No README additions or delivery claims are made.

OAuth plus unused-response ownership checks pass 13 cases. A fake-clock red regression additionally reproduced transport.closed remaining pending forever on a stalled session DELETE. Bound termination to one second, race teardown against that deadline, abort network operations, reject late fetches before body readers open, and pass the signal into bounded error-body reading. The owning ownership/termination file passes all 10 cases, including reader cancellation/unlock on an infinite error body, in /tmp/mcp-http-session-termination-reader-gate.log.
