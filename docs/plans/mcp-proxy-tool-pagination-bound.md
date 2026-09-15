# Proxy tool pagination bound

Two fast memfs regressions reproduced a server returning 129 distinct pages exhausting discovery without any bound. Both fresh discovery and refresh with an existing working cache previously completed instead of rejecting. Bound nonterminating discovery to 128 pages, retain repeated-cursor diagnostics, and permit a terminating 128th page.

All 72 maintained proxy cases passed after the bound. On failure, the upstream client closes once, no new cache is published, and existing cache bytes and command children remain unchanged. Evidence: /tmp/mcp-proxy-pagination-bound-red.log and /tmp/mcp-proxy-pagination-bound-green.log. No README additions, commits, pushes, or release claims are made.
