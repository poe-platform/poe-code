# safe-bash-network-engine

Portable HTTP transfer, authorization, request-body and response-stream primitives shared by Safe Bash curl and wget. Uses injected filesystem and stream contracts without host filesystem access. This private engine is bundled into Safe Bash; consumers use `@poe-platform/safe-bash/commands/network`, `@poe-platform/safe-bash/commands/curl`, or `@poe-platform/safe-bash/commands/wget`. Curl argument and config parsing belongs to the curl command workspace.

`createFetchTransport()` advertises `supportsResponseHeaderTimeout`, not exact
connection timing. Pass `HttpRequest.responseHeaderTimeoutMs` to bound the wait
until response headers (including connection setup, upload, and server delay).
The timer stops before body streaming; caller cancellation remains active.
Timeout raises `CurlError` with exit code 28. Omitted or zero deadlines disable
this timer. An exact `connectTimeoutMs` request requires another transport.
