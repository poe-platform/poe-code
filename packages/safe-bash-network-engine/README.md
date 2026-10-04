# safe-bash-network-engine

Portable HTTP transfer, authorization, request-body and response-stream primitives shared by Safe Bash curl and wget. Uses injected filesystem and stream contracts without host filesystem access. This private engine is bundled into Safe Bash; consumers use `@poe-platform/safe-bash/commands/network`, `@poe-platform/safe-bash/commands/curl`, or `@poe-platform/safe-bash/commands/wget`. Curl argument and config parsing belongs to the curl command workspace.

`createFetchTransport()` advertises `supportsResponseHeaderTimeout`, not exact
connection timing. Pass `HttpRequest.responseHeaderTimeoutMs` to bound the wait
until response headers (including connection setup, upload, and server delay).
The timer stops before body streaming; caller cancellation remains active.
Timeout raises `CurlError` with exit code 28. Omitted or zero deadlines disable
this timer. An exact `connectTimeoutMs` request requires another transport.

The internal transfer executor is shared by the curl and wget frontends. It owns
per-hop authorization, redirects, retries, deadlines, response disposal and
virtual output publication; each frontend supplies its argument and diagnostic
profile. It is bundled into Safe Bash, not installed separately by consumers.

Stdin request bodies use retained staging in the caller's filesystem, below the
command's working directory, for redirects and retries. Replay reads and writes
are at most 16 KiB and await storage backpressure. The filesystem must authorize
staging there and support retained writes, reads and cleanup; there is no host
filesystem or private memory fallback. A first upload can still succeed without
replay storage, but a subsequent replay fails with curl status 65. Partial stdin
uploads cannot replay. Storage is removed on transfer completion/cancellation;
identity conflicts fail closed rather than deleting another writer's content.
Direct internal `createBody` users must await `close()` after consuming the body.

`maxUploadBytes` still limits total upload bytes. `maxBufferBytes` limits
materialized control values, not replay size. File uploads use `readFileStream`
(streaming or retained range reads, never a whole-file fallback); downloads keep
their streaming output path. Wget URL input lists remain materialized URL control
state, governed by `maxBufferBytes`, `maxInputLines` and `maxUrls`; curl query
strings, multipart headers, cookies, CA certificates and user config likewise
require finite host limits. A memory filesystem stores its contents in RAM:
large Worker uploads require a suitable caller-injected external backend.
