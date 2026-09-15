# Modern admission of legacy client methods

The 2026-07-28 specification removes wire methods ping and logging/setLevel. Two red in-memory client regressions reproduced both still being sent on modern connections. Preserve the client health API by using modern server/discover with existing metadata/result/cache validation and cancellation. Log-level changes have no modern wire counterpart and must reject locally with a legacy-protocol diagnostic. Legacy calls retain their original methods and cancellation support.

Verify modern admission, maintained negotiation, setup/subscription cancellation, and legacy SDK fixtures. No README additions or delivery claims are made.
