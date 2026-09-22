# Sandbox deployment contract

This deployment uses stable `@cloudflare/sandbox` **0.12.9**, with the same
`docker.io/cloudflare/sandbox:0.12.9` image. Preserve both package locks. This
is not a 1.0 preview integration: do not substitute preview argv/process handles
or remove stable transport selection without a separately qualified migration.

## Configuration and ingress

`provider.ts` declares port **8080**, **RPC** SDK control transport,
`sleepAfter: '5m'`, `keepAlive: false`, `enableDefaultSession: false`, instance acquisition timeout **30 seconds**,
and port readiness timeout **90 seconds**. Each HTTP transfer direction has a
**256 MiB** ceiling, **1 MiB** maximum chunk and **five-minute** deadline, further
limited by credential expiry. These are application bounds, not measured
provider capacity. SDK RPC selection does not establish binary data-plane fidelity.

`wrangler.json` selects `standard-1`, at most **one** container, `nodejs_compat`,
and disables workers.dev and preview URLs. It intentionally contains no public
route, tunnel or R2 mount. An operator must select a private service binding or
authenticated domain ingress before production use. Publishing this Worker
alone does not establish a production route or working media backend.

The Worker requires `Sandbox` and `AUTHORIZATION` bindings. The latter is a
trusted authorization service receiving POST `/authorize` with the original
Authorization header and JSON `{ audience, method, path }`. It must validate
credential, audience, tenant, permissions and expiry and return
`{ namespaceId, expiresAt }`. Replies are bounded to 4096 bytes. The SDK identity
is a domain-separated digest of that opaque, case-sensitive namespace. Never
derive tenancy from client namespace headers or endpoint knowledge. The media
server must independently authenticate the forwarded credential.

## Container composition

After the maintained remote-execution build, run the local image preparer with
an operator module and a new output directory:

```sh
node packages/remote-execution/cloudflare/prepare-image.mjs /absolute/operator.mjs packages/remote-execution/cloudflare/image
```

This bundles checkout-local server code and the operator module and copies
checksum-bound asset locks and the native byte-argv launcher source. It performs
no cloud provisioning. Image preparation is not an image build or qualification.
The Dockerfile preserves Sandbox ENTRYPOINT and starts the server through CMD.

The operator module supplies `createMediaDeployment` options: server
authentication, canonical namespace/native isolation backend, build and tool
inventory, admissions, upload storage, explicit limits and lease/retention policy.
It also supplies `origin`, `maxConnections`, `sweepIntervalMs`, and `close()`.
Consult the exported types in `media-cli/src/server.ts` and
`remote-execution/src/media-server.ts` for the complete options. Bootstrap reads
only `POE_CODE_SERVER_PORT` (default 8080; must match provider port). Worker
`SANDBOX_TRANSPORT` is explicitly `rpc`; it is not a container credential.
Neither module implicitly forwards ambient credentials to native jobs.

Bootstrap refuses a backend without declared live-files evidence. Such evidence
is an operator assertion until verified in actual Sandbox. No qualified canonical
mount/hook/backend is bundled here. Supplying a host-directory copy or declaring
a feature cannot establish late file access, retained identity or canonical writes.
Container disk is ephemeral across stops; persistent canonical authority must be
selected explicitly. Instance sizing is not per-job resource isolation.

## Binary execution and retirement

The SDK adapter implements generic `RemoteExecutionDriver` using
`containerFetch(request, port)` and `destroy()`. Native launch, binary descriptor
lanes, seekable file operations, effects and group cancellation use the common
server `/v1/*` protocol. The provider does not interpret media tool names or call
SDK exec/log/PTY helpers. Text output or successful SDK transport selection is
insufficient evidence for arbitrary byte streams and full duplex.

Endpoint destruction retires local request/stream authority, waits for pending
SDK calls and destroys the container. Retained endpoints cannot reacquire it;
failed cleanup remains quarantined. This behavior is scoped to the driver
instance. It does not prove fleet-wide retirement across Worker isolates or
revoke credentials. Container shutdown stops admission and sweeping, retires
media jobs/delegates, then closes operator resources and sockets. Failures must
remain visible. Deployment owners must define cross-isolate cleanup and recovery.

R2 staging is disabled. If added, preserve canonical identity and revisions,
immutable object/version identity, explicit bounded and expiring transfer
authority, and canonical effect settlement. Bucket mounts do not establish POSIX
semantics. Verify required R2 binding and ContainerProxy export and every selected
mount/hook in the actual pinned Sandbox deployment.

Local mocks/type checks are separate from native image and cloud evidence. See
`docs/plans/cloudflare-sandbox-execution-gate-20260920-current.md`. No deployment,
image publication or billable provisioning is authorized by this contract.
