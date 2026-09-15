# OAuth metadata body ownership and byte bounds

Two failing discovery checks reproduced error response bodies not being cancelled and oversized declared metadata bodies being read without bounds. Cancel non-success bodies before fallback. Read successful metadata with the maintained UTF-8 byte-bounded helper and a one-MiB metadata limit before JSON parsing. Preserve invalid-JSON diagnostics while retaining explicit size-limit failures.

Focused discovery ownership/security/fallback/cache/identity suite passes. Add streamed UTF-8 multibyte bounds and follow with full client validation.
