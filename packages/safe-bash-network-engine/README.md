# safe-bash-network-engine

Portable shared helpers for Safe Bash. Uses injected filesystem and stream contracts without host filesystem access.

`createFetchTransport()` advertises `supportsResponseHeaderTimeout`, not exact
connection timing. Pass `HttpRequest.responseHeaderTimeoutMs` to bound the wait
until response headers (including connection setup, upload, and server delay).
The timer stops before body streaming; caller cancellation remains active.
Timeout raises `CurlError` with exit code 28. Omitted or zero deadlines disable
this timer. An exact `connectTimeoutMs` request requires another transport.
