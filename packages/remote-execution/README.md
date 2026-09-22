# remote-execution

Portable authenticated execution clients, binary streaming and file-transfer
protocols, with Node-only server and native driver exports. This private workspace
is shipped through poe-code; it is not a separately published npm package.

```ts
import { createClient } from '@poe-code/remote-execution';

const client = createClient({
  baseUrl: 'https://execution.example',
  token: async () => hostCredential,
  fetch: hostFetch,
});
const capabilities = await client.capabilities();
```

Credentials, transports, native tools, providers and filesystem authority are
explicit host inputs. Imports do not launch processes or start services. Native
tool definitions are injected; the generic server does not parse media argv.

## Exports

- `@poe-code/remote-execution`: clients, process adaptation, canonical job/effect
  composition, upload helpers and portable hosting drivers.
- `/protocol`, `/wire`, `/binary`: protocol types, validation and binary framing.
- `/server`: Node-only upload/execution servers, HTTP service and native drivers.
- `/schemas/v1/*`: versioned wire schemas and `http.openapi.json`.

## Client configuration

| `createClient` option | Default / requirement |
| --- | --- |
| `baseUrl` | Required credential-free HTTPS origin; no path prefix, query or fragment |
| `token` | Required async credential supplier |
| `fetch` | `globalThis.fetch` |
| `maxResponseBytes` | `1048576`; positive control-document bound |
| `maxInputBatchBytes` | `1048576`; positive binary-input batch bound |
| `maxConcurrentUploads` | `1`; separate positive upload/credential concurrency bound |

`createUploadClient` additionally requires `sessionId`, `epoch`, `maxChunkBytes`
and a string-or-async `token` supplier. `createExecutionClient` uses the same
session scope without `maxChunkBytes`, plus optional `maxResponseBytes`.
`uploadDescriptor` requires a caller-owned descriptor, declared size/digest,
`maxChunkBytes` and qualified `freshness`; optional `signal` and `resume` preserve
the same source identity/version. File mtime or a pathname alone is not freshness.

Mutations are not automatically retried. Retain operation keys and authenticated
session/job/epoch identities, inspect ambiguous acceptance, and recover retained
state before resubmission. Streams carry bytes with awaited delivery and credit;
callback JSON does not carry media payloads.

## Canonical execution

`createJobBinding` requires `sessionId`, `epoch`, `buildId`, `sourceAuthorityId`,
`bindingId`, canonical `fs`, local `credential`, `maxCallbacks`, `maxHandles`,
`prepare` and `run`. Optional settings are `handles`, `effects`, `retainOutput`,
`endpoints`, `maxIoBytes`, `maxDirectoryEntries`, `validate` and `release`.
The native adapter must authenticate callbacks and mediate actual file/socket
accesses. Discovery predictions do not grant authority or establish snapshots.

Effect stores and output retrieval preserve partial effects and caller-owned
destination cursors. Retained output identities and freshness bindings must come
from the canonical host. Native cancellation, output completion and cleanup are
separate observations.

## Server configuration

`createMediaServer` requires `authenticate`, `builds`, `tools`, `driver`,
`admissions`, `storage`, `limits`, `leaseMs`, `retentionMs`, `maxDocumentBytes` and
`maxRecords`; optional settings are `cleanupGraceMs` and `now`.
Each tool supplies `id`, `buildDigest`, `executable`, `requiredFeatures` and optional
`requiresFrontendContract`. Drivers supply qualified `features`, `inspectBuild`,
`admitSession` and optional deployment `limits`.

`limits` contains `maxJobs`, `maxHandles`, `maxArgvBytes`, `maxManifestEntries`,
`maxFrameBytes`, `maxInflightBytes`, `maxBlobBytes`, `maxReplayBytes`, `maxCallbacks`,
`maxNativeMemoryBytes`, `maxNativeProcesses` and `maxJobDurationMs`. Bounds narrow
operator/provider ceilings; transport buffers do not enforce whole-process memory.
`storage` supplies atomic `append`, bounded owned `read` and `remove`; `admissions`
supplies durable `record` and `inspect`. Call service sweep regularly and await
shutdown. Process-local recovery cannot promise continuity across lost server state.

The upload server takes `storage`, `authenticate`, optional `now` and upload
`limits`: `maxBlobBytes`, `maxReservedBytes`, `maxChunkBytes`, `maxConcurrent`,
`maxUploads`, `maxChunks`. The execution server adds `materializations`: private
storage root, optional injected `fs`, document/entry/path/tree/record bounds,
optional argument bounds, `authorize`, optional `liveNamespace` and `namespace`.
Native drivers take `backend` and optional `launcher`; installation and isolation
remain responsibilities of the qualified backend.

HTTP service configuration supplies `createService`, `http`, `listen.host`,
`listen.port`, `sweepIntervalMs`, `shutdownGraceMs`, `requestTimeoutMs`,
`headersTimeoutMs`, `keepAliveTimeoutMs` and `reportError`. TLS and HTTP limits
are explicit. See exported TypeScript contracts and versioned schemas for nested
configuration and wire request fields.

## Hosting providers

Hosting transports and native filesystem isolation are separate capabilities.
The root facades are `poe-code/remote-execution`,
`poe-code/remote-execution/server` (Node only), and
`poe-code/remote-execution/providers/*` for portable provider configuration.

| Factory | Configuration |
| --- | --- |
| `createRemoteExecutionRoute` | `authenticate`, `driver`, optional `now`, optional `transferLimits` (`maxChunkBytes`, `maxBytes`, `maxWallClockMs`) |
| `createRestExecutionDriver` | `transport: 'https'`, optional `endpoints`; explicit resolver or endpoints required; injected fetch/clock/retirement hooks |
| `createContainerExecutionDriver` | `port`, `transport`, `lifecycle` (`sleepAfter`, `keepAlive`, optional `enableDefaultSession`, `containerTimeouts`), optional `transferLimits`; injected SDK-handle resolver |
| `createModalExecutionDriver` | `transport: 'https'`, `executionClass`, `port`, `readinessTimeoutMs`; injected service resolver, fetch and clock |

Endpoint entries contain `origin` and `expiresAt`. Container timeouts contain
`instanceGetTimeoutMS` and `portReadyTimeoutMS`. Provider credentials and SDK
handles are injected; factories do not discover ambient accounts or provision
resources on import. Hosting a container does not qualify native media compatibility.

## Environment and validation

Product libraries expose no ambient environment-variable configuration. Native
child environment is explicitly admitted invocation data. Build and opt-in
integration variables are not product credential/configuration sources.

Explicit native qualification uses these variables:

| Variable | Purpose |
| --- | --- |
| `DOCKER_CONTEXT` | Standard Docker CLI context inherited by `test:container`; otherwise Docker uses its configured context |
| `REMOTE_MEDIA_IMAGE_DIGEST` | Tested image identity supplied by the disposable container runner |
| `REMOTE_PROCESS_NATIVE=1` | Required opt-in for host-native invocation and descendant-cleanup oracles |
| `REMOTE_PROCESS_FFMPEG` | Absolute executable path for the separate FFmpeg process oracle |
| `REMOTE_PROCESS_HTTP=1` | Run that FFmpeg oracle through the authenticated Fetch handler/client adapter |
| `POE_CODE_SERVER_PORT` | Operator Cloudflare bootstrap port, default `8080`; Modal deployment pins it to the explicit provider port |

These oracles launch native tools only through their explicit integration routes.
The loopback HTTP profile does not qualify a deployed HTTPS service or a complete
canonical filesystem backend.

Run the workspace `test:unit`, `lint` and `protocol:check` commands for maintained
checks. `test:container` is an explicit native integration route. Mocked success,
portable import checks and source declarations do not establish deployed isolation
or full provider qualification.
