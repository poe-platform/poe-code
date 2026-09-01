# Independent HTTP request dispatch (POE-016)

## Required behavior

A slow HTTP JSON response must not hold later tool calls or their cancellation
notifications in the transport queue. Dispatch independent requests while earlier
responses remain pending, matching the existing early-header SSE behavior. Abort
and timeout must settle callers promptly and send the matching cancellation once.
Cancellation remains best effort; it cannot undo work already executed remotely.

## Implementation

Keep the initialization response-header barrier and wait for the initialized
notification to be accepted before sending requests, so subsequent requests retain
the negotiated session and cannot overtake server startup. Dispatch later POSTs
independently with owned rejection handlers. Preserve JSON/SSE forwarding,
session expiry, and transport-wide close
behavior. Ignore late responses after disposal and prevent prepared requests from
starting after disposal. Do not change public APIs or authentication behavior.

## Validation and delivery

- Add failing public client/transport regressions using intercepted fetch and
  controlled responses, without network calls, real files, or models.
- Cover delayed JSON headers, early SSE headers, stateful/stateless sessions,
  abort, timeout, independent completion, initialization, failure, and close.
- Run focused tests on supported Node versions and the maintained package build.
- Commit this fix and plan with normal hooks, then push canonical main.
- Per the September 1 instruction, do not wait for or repair release workflows;
  the dedicated engineer owns releases. Record a push separately from a release.

## Verified before commit

- The initial 15 regressions reproduce eight failures and seven passing controls.
  The expanded lifecycle suite has 21 passing cases.
- All 231 focused transport/client cases pass on Node 18.18.2, 20.20.0,
  22.22.2, and 24.14.0. All 342 package tests pass on the default Node 22.
- The maintained `tiny-mcp-client` workspace build closure passes. The unmodified
  built public API passes all 21 lifecycle cases on each of those four Node
  versions, with no source-runtime substitution.
- An exploratory full-package Node 18 run has seven failures in the OAuth test
  server's global `crypto` usage and the clean-process TypeScript loader. Those
  unrelated files are unchanged; the focused and built API checks pass without
  polyfills or exclusions within their selected suites.
- This change has no visual CLI surface. Release verification is handed off and
  does not block subsequent commits or pushes.

## Startup-order correction

The full local push gate catches requests overtaking `notifications/initialized`
with the actual HTTP server. Stop that failing push without bypassing hooks,
extend the controlled startup regression (one failure before correction), and
retain both startup barriers. Verify the actual HTTP server compatibility suite
in addition to the client suites before committing and retrying the normal push.
The first commit remains intact; no release workflow is involved.

The corrected source passes all 723 client/server tests on Node 20/22/24 and all
231 focused transport/client tests on Node 18/20/22/24. The maintained selected
workspace build passes again, and its unmodified built public API passes all 21
lifecycle cases on each of those four Node versions.
