# Token exchange lifecycle and credential redirects

Two red in-memory checks reproduced token exchange lacking a deadline/redirect policy and a stalled token response remaining pending after its deadline should abort. Give the token exchange one 30-second deadline through fetch and bounded body parsing. Explicitly forbid redirects when posting authorization codes and client credentials. Cancel and release the body on deadline abort and preserve the abort reason.

Run lifecycle, token parsing, response-byte bounds, and the full maintained OAuth suite. Dynamic registration fetch lifecycle remains a separate pending audit.
