# Redirect rejection must settle independently of cleanup

The shared redirect guard awaited response.body.cancel before rejecting. A ReadableStream adapter whose cancellation promise never settles therefore prevented the guard from reporting its admission failure, including for OAuth/JWKS callers with fetch deadlines.

Two fast in-memory tests cover redirected and opaque-redirect responses with intentionally pending cancellation. Both failed before the fix: cancellation started, but the redirect error had not settled after an event-loop turn. Cleanup now starts cancellation and handles its eventual rejection without awaiting it; the admission error settles promptly.

Red evidence: /tmp/mcp-redirect-cancellation-deadlock-red.log. Green evidence: /tmp/mcp-redirect-cancellation-deadlock-green.log. Final protocol/OAuth gate and maintained affected builds must follow. Injected adapters still own the completion of their underlying cleanup; this change prevents stalled cleanup from blocking admission failure.
