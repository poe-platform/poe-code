# OAuth token and registration response bounds

Three failing in-memory tests reproduced ignored declared size limits, unbounded streamed bodies, and malformed UTF-8 accepted with replacement characters. Token and dynamic registration responses share the same object reader, so use the maintained strict UTF-8 reader with a one-MiB limit there. Preserve existing OAuth error mapping and JSON-object diagnostics while reporting oversized bodies explicitly.

The three regressions and eight maintained token endpoint checks pass. This does not verify real authorization servers or network connectivity.
