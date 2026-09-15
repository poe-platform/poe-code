# SafeJS MCP HTTP reader ownership

A focused in-memory transport test reproduced upstream response bodies remaining locked after calls and close. The historical fake server first needed a proper MethodNotFound response to the modern discovery probe instead of returning a malformed tool result; this fixture correction enables honest legacy fallback coverage.

Release owned upstream readers on completion/read errors, after cancellation, and after abort-driven cancellation settles. Keep cleanup idempotent and preserve signal/timer removal. Managed MCP suite rerun is running. Add direct modern transport coverage and error/abort/cancel ownership regressions; do not count legacy fixtures as modern coverage.
