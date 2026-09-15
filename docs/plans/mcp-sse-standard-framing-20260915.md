# Follow standard SSE framing

Authoritative reference: https://html.spec.whatwg.org/multipage/server-sent-events.html, parsing/interpreting an event stream. Lines may end in LF, CR or CRLF. Pending data at EOF must be discarded; incomplete events are not dispatched.

Six regressions failed before the change: three incomplete EOF forms, CR-only events, split CRLF, and reconnect cursor advancement from an unfinished event. Process CR/LF boundaries across chunks and discard unfinished state at EOF. Keep existing event byte limits and completed event handling.

Focused framing and limits validation: 14 tests passed. Client build/lint and the complete client suite are required before commit. Modern HTTP correlation changes remain separate.

Verified before commit: complete client suite 456 tests / 26 files passed, selected six-build client closure passed, focused client ESLint passed. Stage only the SSE parser hunks, framing regressions and this plan.
