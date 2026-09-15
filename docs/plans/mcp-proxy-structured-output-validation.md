# Proxy structured output validation

Four fast memfs regressions reproduced successful upstream structured outputs violating their declared schema being exposed through proxy command handlers. Object required fields, scalar multipleOf, array item types, and open-object child constraints all failed to reject before the fix. The SDK invokes the same handler but performs no general output validation, so validation belongs at this upstream boundary.

Validate successful structuredContent with the owning converted schema before exposing it. Retain original values and upstream error envelopes, and keep the existing missing-structuredContent diagnostic. Handler and SDK regressions, maintained proxy entry points, and a real in-memory upstream/client transport pass 91 cases in /tmp/mcp-proxy-output-validation-green2.log. No README additions or delivery claims are made.
