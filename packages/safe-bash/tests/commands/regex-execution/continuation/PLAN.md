# Frozen author continuation expectations

Baseline marker independently committed at 471f4ca; product sources still
unchanged when these expectations were written. No pathological probe: allocation
zero, all six additional probes untouched. Children use strict unhandled rejection,
256 MiB old-space limit, 30-second parent kill bound, 2 MiB captured output bound.

- Actual compiled public default Shell/agentCommands grep and rg select `ab`.
- No Worker at registration or preaborted invocation. Normal/invalid-pattern and
  malformed-glob command settlement leaves no live owned Worker or listeners.
- CLI filename glob construction/matching and ignore-file rules never construct
  user-derived RegExp on the host. The frozen benign sentinel is `alpha`.
- CLI positive/negative/insensitive/brace/directory filters and ignore precedence
  preserve exact ordered output. Malformed CLI globs fail before pattern-file I/O.
- The original public early-EOF command must leave zero live Workers BOTH at exec
  settlement and after Shell.dispose. Keep both failures if external lifecycle
  ownership remains unavailable; eventual retirement is not a passing substitute.
- Concurrent live grep/rg pipelines select exact bytes and eventually retire exact
  workers. Caller abort is observed separately from command handler cleanup.

Run the same static child against baseline dist, final dist, and an actual moved
npm package. Preserve initial red assertions and every correction separately.
Independent verifier owns complete command benchmark; author runs bounded smoke.
No all-suite/default-acceptance or superiority claim.
