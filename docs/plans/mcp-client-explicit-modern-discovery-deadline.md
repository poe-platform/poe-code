# Explicit modern discovery deadline

The final built root CLI QA reproduced a silent downgrade to 2025-03-26 despite an explicit 2026-07-28 client preference. The one-second automatic compatibility probe deadline expired during startup, although direct discovery confirmed modern support.

A fast in-memory fake-timer regression reproduces this with a 1.5-second discovery response and a configured five-second request timeout. It failed before the fix, returning the legacy version. Explicit modern discovery now uses the configured request deadline (30 seconds by default); automatic compatibility probes retain their existing short deadline.

Red evidence: /tmp/mcp-explicit-modern-deadline-red.log. Green negotiation and cancellation evidence: /tmp/mcp-explicit-modern-deadline-green.log, 33 passing tests. Repeat maintained client build, broad affected consumers, types, lint, root bundle and real root CLI modern/legacy reads before final delivery.
