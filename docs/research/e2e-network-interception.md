# E2E Network Interception Investigation

## Context

US-008 investigates whether we can intercept and mock HTTP traffic inside e2e
containers for tests that need to verify API calls without hitting real services.

The current e2e test library (`@poe-code/e2e-docker-test-runner`) uses persistent
Docker containers via `docker create` + `docker exec`. Tests execute CLI commands
and assert on stdout, stderr, exit codes, and filesystem state. There is no
mechanism to observe or mock outbound HTTP requests.

## Approaches Evaluated

### 1. mitmproxy Sidecar Container

Run mitmproxy as a separate container on the same Docker network. Route test
container traffic through it via `http_proxy`/`https_proxy` environment variables.

**Setup:**
```
docker network create e2e-net
docker run -d --name proxy --network e2e-net mitmproxy/mitmproxy mitmdump -s /tmp/addon.py
docker create --network e2e-net -e http_proxy=http://proxy:8080 -e https_proxy=http://proxy:8080 ...
```

**HTTPS handling:** Requires installing the mitmproxy CA certificate in the test
container and setting `NODE_EXTRA_CA_CERTS` for Node.js processes.

**Spike results (validated):**
- HTTP interception: works immediately via proxy env vars
- HTTPS interception: works with CA cert installation + `NODE_EXTRA_CA_CERTS`
- Request capture: Python addon writes JSONL to file, readable via `docker exec`
- Response mocking: Python addon can return synthetic responses for matched URLs
- Overhead: negligible (~0-10ms per request, within noise)

**Assertion flow:**
```
test makes CLI call → CLI makes HTTP request → mitmproxy captures to JSONL →
test reads JSONL via docker exec → asserts on captured requests
```

| Criteria | Rating | Notes |
|----------|--------|-------|
| Setup complexity | Medium | Requires Docker network, sidecar container, CA cert |
| Reliability | High | mitmproxy is battle-tested, deterministic capture |
| Overhead | Negligible | <10ms per request |
| Assertion API | Medium | Parse JSONL from file, needs helper functions |
| HTTPS support | Yes | Requires CA cert in container + `NODE_EXTRA_CA_CERTS` |
| Mock responses | Yes | Python addon can intercept and respond |
| Maintenance | Medium | Python addon scripts, mitmproxy image updates |

### 2. In-Container Proxy

Install mitmproxy (or a lighter proxy like tinyproxy) directly inside the e2e
Docker image. All traffic routes through localhost proxy.

**Setup:**
```dockerfile
# In e2e.Dockerfile
RUN pip install mitmproxy
```

```typescript
// In test setup
await container.exec('mitmdump -p 8080 -s /tmp/addon.py &');
// Set proxy env vars for subsequent commands
```

**Trade-offs:**

| Criteria | Rating | Notes |
|----------|--------|-------|
| Setup complexity | Low | Single container, no network config |
| Reliability | Medium | Background process management inside container |
| Overhead | Negligible | localhost proxy, no network hop |
| Assertion API | Medium | Same JSONL approach, simpler file access |
| HTTPS support | Yes | Same CA cert approach |
| Mock responses | Yes | Same Python addon |
| Maintenance | High | Pollutes base image, mitmproxy is 100MB+ |

**Key concerns:**
- mitmproxy adds ~100MB to the Docker image (Python + dependencies)
- Background process management (`mitmdump &`) is fragile in containers
- Every test pays the image size cost even when proxy isn't needed
- Tightly couples proxy lifecycle to container lifecycle

### 3. Node.js Mock Server (Host-Side / Network Peer)

Run a lightweight Node.js HTTP server on the same Docker network that serves
canned responses. The CLI under test must connect to this server instead of the
real API.

**Setup:**
```typescript
// In test setup
const mockServer = await startMockServer(network);
// Configure CLI to use mock server URL
await container.exec(`poe-code configure --api-url http://mock-server:3000`);
```

**Spike results (validated):**
- HTTP mock server works on the Docker network
- Test container can reach it by container name
- Easy to program responses in Node.js/TypeScript

| Criteria | Rating | Notes |
|----------|--------|-------|
| Setup complexity | Low | Node.js server, same language as tests |
| Reliability | High | Direct HTTP, no TLS complexity |
| Overhead | Negligible | Direct network call |
| Assertion API | Easy | In-process, native Jest/Vitest assertions |
| HTTPS support | Partial | Needs self-signed cert or HTTP-only |
| Mock responses | Yes | Full control, same language |
| Maintenance | Low | No external dependencies |

**Key concern:** Requires the CLI to support configurable API endpoints (e.g.
`--api-url` flag). If the CLI hardcodes API URLs, this approach doesn't work
for intercepting those calls. This is a **design constraint on the CLI itself**,
not just the test infrastructure.

### 4. Docker Network-Level Interception (iptables/nftables)

Use `iptables` rules inside the container to redirect traffic to a local proxy.
This is transparent — no proxy env vars needed.

**Not spiked.** Requires `CAP_NET_ADMIN` capability and iptables installed in
the container. More complex, less portable, and solves the same problem as the
proxy env var approach without meaningful benefits for our use case.

## Comparison Matrix

| | mitmproxy sidecar | In-container proxy | Node.js mock server | iptables redirect |
|---|---|---|---|---|
| **Setup** | Docker network + sidecar | Dockerfile change | Node.js server | CAP_NET_ADMIN + iptables |
| **Image impact** | None | +100MB | None | +iptables pkg |
| **HTTPS** | CA cert + NODE_EXTRA_CA_CERTS | Same | Self-signed or HTTP | Same as sidecar |
| **Transparency** | Via env vars | Via env vars | Requires `--api-url` | Fully transparent |
| **Assertion ease** | Parse JSONL | Parse JSONL | In-process | Parse JSONL |
| **Response mocking** | Python addon | Python addon | Native Node.js | Python addon |
| **Dependencies** | mitmproxy Docker image | mitmproxy in image | None | iptables |
| **Overhead** | ~0-10ms | ~0ms | ~0ms | ~0ms |

## Assertion API Design (If Implemented)

If we were to implement the mitmproxy sidecar approach, the assertion API
would look like:

```typescript
// Container creation with proxy
const container = await createContainer({ proxy: true });

// After CLI commands that make HTTP requests
const requests = await container.getCapturedRequests();

expect(requests).toContainRequest({
  method: 'POST',
  url: /api\.openai\.com\/v1\/chat/,
  headers: { 'Authorization': expect.stringContaining('Bearer') },
});

// Mock responses
await container.mockResponse({
  match: { url: /api\.openai\.com/ },
  respond: { status: 200, body: { choices: [{ message: { content: 'hello' } }] } },
});
```

**Implementation complexity:**
- `createContainer({ proxy: true })` → creates Docker network, starts mitmproxy
  sidecar, installs CA cert, sets env vars
- `getCapturedRequests()` → reads JSONL file from mitmproxy container via
  `docker exec`
- `mockResponse()` → writes Python addon script, restarts mitmdump with new
  script (or uses mitmproxy's REST API)
- Custom vitest matchers: `toContainRequest()`, `toHaveBeenCalledWithBody()`

**Estimated effort:** 2-3 stories to implement robustly (network setup, capture
API, mock API, matchers, documentation).

## Recommendation: Defer

**Rationale:**

1. **Current tests don't need it.** All 4 agent e2e tests (codex, claude-code,
   goose, aider) validate CLI behavior: install succeeds, configure writes files,
   test command passes. None of them need to verify specific HTTP request
   payloads.

2. **High complexity for current ROI.** The mitmproxy sidecar approach (the best
   option) requires: Docker network management, sidecar container lifecycle, CA
   cert installation, Python addon scripting, JSONL parsing, and custom matchers.
   This is significant infrastructure for a need that doesn't exist yet.

3. **The Node.js mock server is simpler when needed.** If/when we need mock
   responses (e.g., testing without API keys, simulating error responses), a
   Node.js mock server on the Docker network is lighter weight and uses the same
   language as the tests. But it requires the CLI to support configurable API
   endpoints.

4. **Proxy env vars may not be respected.** Some agent binaries (codex, claude)
   may not respect `http_proxy`/`https_proxy` env vars. This would make the
   mitmproxy approach unreliable without iptables-level interception, which adds
   even more complexity.

**When to revisit:**
- When we need to test API interactions without real API keys (cost reduction)
- When we need to verify specific request payloads (e.g., model parameters)
- When we need to simulate API error responses (rate limits, auth failures)
- When the CLI supports configurable API endpoints (makes mock server viable)

**If we implement, use:** mitmproxy sidecar approach. It's the most reliable,
doesn't pollute the base image, and the Python scripting API is powerful enough
for both capture and mocking.
