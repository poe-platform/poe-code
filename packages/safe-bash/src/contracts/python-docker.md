# Explicit Docker Python host

The Node-only `@poe-platform/safe-bash/commands/python/docker` entry point
provides `createDockerPythonExecutorPool`. Unlike the trusted in-process Node
worker, this host runs every invocation in a fresh, non-root Linux container.
The application must trust and maintain its Docker daemon, host kernel and
runtime image. This is OS container isolation, not a separate kernel or a claim
of immunity to container-runtime/kernel vulnerabilities.

```typescript
import { Shell } from '@poe-platform/safe-bash';
import { pythonCommands } from '@poe-platform/safe-bash/commands/python';
import { createDockerPythonExecutorPool } from '@poe-platform/safe-bash/commands/python/docker';
import { MemoryFileSystem } from '@poe-platform/safe-fs/core';

const pool = await createDockerPythonExecutorPool({
  socketPath: '/var/run/docker.sock',
  image: qualifiedImageId,
  memoryBytes: 256 * 1024 * 1024,
  cpus: 1,
  deadlineMs: 15_000,
  maxConcurrentExecutors: 2,
});
const shell = new Shell({ fs: new MemoryFileSystem() })
  .use(pythonCommands({ createExecutor: pool.createExecutor }));
try {
  const result = await shell.exec('python -c "print(42)"');
} finally {
  await shell.dispose();
  await pool.dispose();
}
```

Share one pool across independent shells and aliases to impose application-wide
admission. Separate pools have separate limits. Shell disposal retires only its
invocations, not the borrowed pool or sibling shells. The host owner disposes the
pool once all clients have finished. Saturation reports the existing `capacity`
failure instead of starting or queueing another interpreter.

## Configuration

All configuration is explicit; product code reads no environment variables or
Docker CLI settings and never pulls images. It communicates over the supplied
Unix socket using Docker Engine API v1.45.

| Option | Contract |
| --- | --- |
| `socketPath` | Required absolute Unix socket path; access grants trusted host-side daemon authority. Never expose it to guest code. |
| `image` | Required immutable local `sha256:` image ID, not a mutable tag or registry reference. |
| `memoryBytes` | Required integer, at least 64 MiB. Per-container memory limit; equal memory+swap limit disables extra swap allowance. |
| `cpus` | Required finite CPU rate in [0.01, 64], across all container processes. Not a cumulative CPU-time or instruction budget. |
| `deadlineMs` | Required integer wall deadline in [1, 86,400,000], supervised outside the guest, starting before container creation. |
| `maxConcurrentExecutors` | Required positive safe integer; reservations include initialization and uncertain retirement. |
| `temporaryBytes` | Positive safe integer; default 16 MiB for the container-private `/tmp` tmpfs. Also charged to container memory. |
| `controlTimeoutMs` | Integer in [1, 300,000]; default 10,000 for Docker control I/O. Cleanup can extend beyond the guest deadline. |
| `maxFrameBytes` | Integer in [65,536, 16,777,216]; default 8 MiB for bounded protocol frames. Must fit the chosen invocation/transfer payloads. |

Preflight requires Linux, reported memory/swap/CPU/pid enforcement, the built-in
seccomp profile, and the exact image ID with label
`org.poe-platform.python-executor=1`. Images declaring volumes are refused.
Unsupported hosts report `isolation-unavailable` before starting a container.
The label declares the protocol; it does not authenticate image contents.

Containers have no host mounts, no inherited parent environment, no outbound
network, a read-only root, UID/GID 65534, all capabilities dropped,
no-new-privileges, a 64-pid limit and a bounded noexec/nosuid/nodev `/tmp`.
Trusted image defaults still exist: build images without credentials or private
data. Python-to-JavaScript reflection and subprocesses may access the container's
own public runtime assets and tmpfs, not the host service's files or daemon socket.
Do not grant extra mounts, devices, networking or credentials to these containers.

Memory, CPU rate and wall supervision cover startup, imports, package expansion,
guest code and descendant processes. The deadline bounds guest execution, not
arbitrary application callbacks. Canonical filesystem, package-fetch and stream
work stays in the host with its existing limits, authority and cancellation
contract; cgroups do not bound host backend allocations. Admission remains held
until forced container removal and tracked cooperative host work settle.
Unconfirmed creation/removal fails closed and retains its reservation rather
than guessing that a potentially live interpreter is gone.

CPU-loop and blocked-input cancellation forcibly remove the invocation container,
suppress new canonical requests and preserve previously acknowledged writes.
No guest workspace is copied back. A fresh interpreter is used after every
success or failure; guest module/JavaScript state is never reused across clients.
Container failures expose sanitized categories, including `deadline`, rather
than Docker response bodies or guest protocol exceptions. Existing bounded
`onProgress` phase events remain available through `pythonCommands`.

## Runtime image and acceptance

The image must contain `/usr/local/bin/node` and
`/runtime/python-executor.mjs`. Install the qualified safe-bash/safe-fs/safe-js
artifacts and Pyodide **314.0.6** in the image during its trusted build, not during
guest startup. The runtime wrapper invokes:

```javascript
import { runDockerPythonExecutor } from '@poe-platform/safe-bash/commands/python/docker';
await runDockerPythonExecutor({
  isolatedContainer: true,
  runtimeModuleURL: new URL('./node_modules/pyodide/pyodide.mjs', import.meta.url).href,
});
```

Runner options are `isolatedContainer: true`, required `runtimeModuleURL` (a
local `file:` URL), and optional `indexURL` (defaults to the module directory).
The runner must only execute in the explicitly isolated container. Its main
thread uses asynchronous pipe I/O while the interpreter worker uses shared
memory **inside that container**. Pyodide changes stdin to nonblocking mode;
synchronous reads on the interpreter thread are not a valid pipe transport.

The maintained opt-in integration is
`tests/integration/python-docker.test.mjs`, with an image recipe and wrapper next
to it. Build that image from a digest-pinned Node base and an installed public
consumer; pass the resulting immutable image ID. Test-only environment variables:

- `SAFE_BASH_PUBLIC_CONSUMER_ROOT`: installed standalone package consumer root.
- `SAFE_BASH_DOCKER_IMAGE`: freshly built, immutable local image ID.
- `SAFE_BASH_DOCKER_SOCKET`: explicit Docker socket path.

Run `node --test --test-concurrency=1 tests/integration/python-docker.test.mjs`
from the safe-bash package. The cohort uses real Python for binary filesystem
operations, native zlib, temporary cleanup, reflected host/network access,
cross-invocation state, shared admission, sibling preservation, CPU cancellation,
opaque input cancellation, deadlines, memory pressure and recovery. These are
required real-host probes, not substitutes for operating-system maintenance or
qualification of a different daemon, runtime image or filesystem backend.
