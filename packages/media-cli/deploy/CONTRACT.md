# Worker deployment contract

`worker.ts` is the deployment entrypoint. It imports the workerd safe-bash
export, portable media-cli engine and remote-execution client. It never imports
`src/sdk/bash.ts`, host filesystem adapters, or native launch code. The pinned
Sandbox SDK is `0.12.9`; the container Dockerfile uses the same version.
`nodejs_compat` supplies the SDK's supported `node:path/posix` implementation,
not authority to launch a process or access a host filesystem.

## Composition and authority

The default runtime rejects commands until an operator supplies a qualified
canonical lease. This is an execution gate, not a working media backend.
Compose an operator entrypoint with `createDeploymentWorker` and
`createCanonicalWorkerRuntime` from this directory. The acquisition callback
receives the authenticated principal, bounded container client, cancellation
signal, command identity, and `persistNative`. It returns `{ fs, bind, close }`.
`fs` is explicitly injected into Shell; `bind` must bind the invocation's scoped
filesystem and borrowed descriptors to the SAME canonical authority, using
`input.client` for transport. Never substitute scratch paths as canonical paths.
Set Wrangler `main` to that operator entrypoint before enabling execution.

`AUTHORIZATION` is an operator service binding. It receives a POST to `/authorize`
with the bearer credential and JSON `{ audience, method, path }`; it must return
`{ namespaceId, expiresAt }` for an authorized caller. Its reply is limited to
4096 bytes. `namespaceId` must encode the authenticated tenant/caller boundary,
not a header-selected namespace. The container authenticates the forwarded token
independently and must enforce the same boundary. Bearer credentials are never
stored in command records. No environment credentials are forwarded to jobs.

The Sandbox adapter hashes the opaque, case-sensitive caller identity into a
stable DNS-compatible name. This avoids reserved Sandbox IDs and the SDK's
63-character limit without truncating the original caller identity. The
application journal remains keyed by the authorization service's identity.
Changing this derivation requires a migration of existing container identities.

## Routes and ownership

- `POST /command`: requires `Idempotency-Key` (1–128 characters), `Shell-Command`
  (at most 8192 UTF-8 bytes), and authentication. Body bytes are shell stdin.
  Response frames are channel byte (1 stdout, 2 stderr), big-endian uint32 length,
  then unchanged payload bytes. Obtain the final exit status from status.
- `GET /command/status`: same authentication and idempotency key; returns the
  caller's command record. Another caller cannot inspect it.
- `/v1/*`: authenticated bounded forwarding to the caller's container API,
  including job inspection, reconnect, and cancellation. Native replay/offset
  guarantees are those of the qualified container server, not the shell route.

No application Durable Object owns a live shell or job executor. Each shell is
request-owned and disposed on completion/disconnect. `CommandJournal` owns
SQLite metadata only: accepted command identities, stdout/stderr delivered
byte offsets, native session/epoch/job identities and effect receipt digests.
The Sandbox Durable Object owns container lifecycle, not shell persistence.
Its existence does not establish native job durability either.

The canonical binder must await `persistNative` after native acceptance and
before acknowledging accepted effects, including interrupted admission and
cleanup. Receipt and job identities are immutable; conflicting digests fail
closed. The journal allows 1024 command records per caller and requires explicit
operator retention cleanup when full; it does not silently evict replay guards.
Job output offsets and effect bodies belong to the qualified native/backend
store. Shell offsets are delivery observations, not a replay log or proof that
the client received the last bytes. Status cannot replay shell output.

## Bounds, lifetime and recovery

At most four live commands are admitted per Worker isolate. This is not a
fleet-wide quota. Command and status routes also share four authorization
operation credits across request factories, independently of live shell credits.
Authorization overflow returns `429` with `Retry-After: 1`. A disconnected request
keeps its authorization credit until the actual service operation settles;
an authorization service ignoring cancellation cannot admit unlimited replacement
operations. A permanently stuck service can exhaust these credits until isolate
replacement. Each command has a five-minute deadline, further limited by
credential expiry and platform lifetime. Stdin/stdout/stderr chunks are bounded
at 64 KiB; input and combined output are each limited to 64 MiB. Two pending
output credits and a zero-prefetch response queue apply backpressure. The
journal has four pending write credits and bounds native recovery metadata to
128 jobs/receipts and 32 KiB. Container `/v1` forwarding uses bounded streams.
At most four `/v1` transfers are admitted per isolate across request factories,
independently of command credits. Admission includes authentication and container
acquisition, and remains held until response EOF, disconnect, error or the
five-minute deadline. Empty responses return their credit immediately. A full
pool responds with `429` and `Retry-After: 1`. Control operations have four separate
credits shared across factories: session lease/close, upload/file close, job
cancel/signal/resource release, and job/materialization callback results and lane
acknowledgments. These credits have the same authentication, transfer bounds and
response retirement rules. Unread data responses cannot consume control capacity;
unread control responses can exhaust their own pool. Route classification grants
no authority and does not bypass container authentication. Neither pool waits for
capacity or automatically retries an operation. These are isolate transfer bounds,
not whole-process memory limits or per-caller/fleet-wide job quotas.
The runtime's portable client also bounds each blob/file range and binary-lane
request/response to these chunk and transfer-byte limits. All client transfers
borrow command cancellation and expiry even when the binder omits a signal.
A transfer limit violation cancels the command; catching that client error cannot
publish a successful command result. Client byte limits apply per HTTP transfer,
not cumulatively to every transfer performed by a command.
Each command has four canonical transfer credits, held until response EOF or
cancellation. Canceling a partial range returns its credit without canceling
the command. Transfer failure, an empty response, response EOF, or response
cancellation also retires any unread upload producer before returning its
credit. This retirement is scoped to the transfer and does not cancel the
command. Credit overflow retires the command. Requests use manual redirects
because workerd does not implement `redirect: "error"`; the portable client rejects
the original redirect response without following it or forwarding credentials.
Command retirement closes client transport authority and cancels remaining
transfers after runtime cleanup; a retained client cannot start later work.
These bounds exclude buffering internal to the SDK/backend, which needs separate
measurement and qualification. Never collect a whole video with `arrayBuffer`.

Use a backend's scoped direct blob transfer only when the canonical authority
supports it: single-object capability, bounded bytes, expiry, revision binding
and effect validation. Jobs must never receive broad storage credentials.
Without that support, bounded streamed Worker transfer is valid; files exceeding
the current byte/deadline limits must be rejected or use another qualified path.
R2 is object storage. It is not this deployment's canonical filesystem. Any R2
filesystem adapter must enforce and qualify retained identity, seek, append,
rename, links, metadata, directories, concurrency, and effect receipts; a bucket
binding or successful upload does not prove these semantics.

Disconnect cancels blocked shell IO; `waitUntil` offers only the platform's
bounded cleanup grace. Native cancellation may be unconfirmed if that grace
expires. After an isolate restart, nonterminal command records require recovery:
inspect persisted native identities and effects through `/v1`, then start a NEW
shell under a new command key. Never replay accepted commands automatically.
The journal does not restore variables, descriptors, pipelines or shell memory.
Long-running detached jobs require a separately qualified native job owner,
leases, persistent streams/effects, and recovery procedure; `/command` does not
promise them. Backend/container restart persistence remains unqualified until
real execution demonstrates it. `sleepAfter: 5m`, `keepAlive: false` and Wrangler's
single-container capacity are explicit operational limits, not durability claims.

## Configuration and checks

Bindings: `Sandbox` (SDK Durable Object/container), `COMMAND_JOURNAL` (application
SQLite Durable Object), and `AUTHORIZATION` (service). Wrangler registers both
Durable Objects with a SQLite migration and maps Sandbox to the selected
remote-execution Dockerfile. Provider port, deadlines, transfer and lifecycle
options live in `packages/remote-execution/cloudflare/provider.ts`; native launch
and server options remain inside the container. This Worker reads no process
environment variables and has no ambient storage credential configuration.

Run `npm run build` to produce the portable shell bundle; a selected workspace
TypeScript build alone does not produce that root suffix stage. Then run
`npm run test:worker-imports --workspace=@poe-code/media-cli` and
`npm run lint --prefix packages/media-cli/deploy`. Local workerd fixtures exercise
binary pipes, explicit file effects, caller isolation, disconnect and journal
survival across isolate replacement. Their mock engines and memory filesystems
are not real Sandbox or persistence qualification. See the qualification plan in
`docs/plans/worker-media-deployment-qualification-20260917.md` for open execution
checks. Cloud execution requires explicit user authorization.
