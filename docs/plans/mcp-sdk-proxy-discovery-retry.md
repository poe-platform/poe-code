# Deferred SDK proxy discovery recovery

A failing in-memory proxy SDK regression reproduced a transient discovery error permanently poisoning the deferred SDK. A later invocation returned the old error without reconnecting despite a healthy queued upstream.

Reset the shared discovery promise only on rejection, preserving concurrent discovery coalescing and successful resolution caching. A later invocation performs normal discovery with existing transactional cache/children behavior.

Verify transient failure/retry, concurrent failure/retry and maintained SDK/proxy coverage with mocked upstreams and memfs.

A separate failing regression reproduced the same permanent rejection cache in deferred MCP server creation. Apply the same owner-local retry behavior to server construction; verify individual and concurrent failure/retry coalescing without opening stdio.
