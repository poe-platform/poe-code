# OAuth metadata candidate deadlines

A fast in-memory regression reproduced a stalled metadata body remaining pending after a deadline abort. Standalone OAuth metadata candidate fetch/read now shares a ten-second deadline and the bounded reader cancels/releases the stalled body.

A second HTTP integration regression reproduced the transport replacing the candidate deadline with its disposal controller. Combine supplied signals with transport cancellation instead, checking pre-aborted signals before network admission. Both deadline and transport disposal remain effective.

Evidence: /tmp/mcp-metadata-deadline-red.log, /tmp/mcp-metadata-deadline-green.log, /tmp/mcp-transport-metadata-deadline-red.log, and /tmp/mcp-transport-metadata-deadline-green.log. Tests abort controlled signals rather than waiting for real timers. Fetch adapters remain responsible for honoring the supplied signal during fetch itself.
