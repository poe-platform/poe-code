# Browser resource boundaries

The playground's `help` command describes its upload, workspace, output, source,
command, and loop budgets. These are application-level limits, not a browser
process memory quota. The engine remains pinned to `poe-code@14.0.4`.

## Regex and ERE workers

Regex searches and `[[ =~ ]]` execute in Web Workers. The pinned engine's
protocol enforces work and byte budgets and request/startup/idle timeouts. Its
Node `resourceLimits` options are not enforced by the browser adapter in
`src/engine/workers.mjs`; that adapter forwards worker data and gives the native
Worker a name, but does not install a heap or stack cap.

The standard browser Worker constructor exposes name, type, and credentials
options, not Node's heap/stack controls. Node's own limits are JavaScript-engine
limits rather than a complete process-memory boundary; external allocations
and global out-of-memory conditions remain relevant even there.

On an ordinary worker error, the adapter terminates that worker and revokes its
blob URL. This cleanup is not proof that the page survives arbitrary memory
exhaustion. Do not treat browser workers, timeouts, or protocol allocation-unit
budgets as a hard heap/RSS guarantee. Memory-pressure measurements, where
available, are likewise not allocation-admission caps.

## Dedicated shell execution

Each command executes in a fresh dedicated worker, including shell parsing and
command execution. A page-owned five-second deadline covers worker startup and
execution. On expiry the page stops admitting filesystem requests, aborts
admitted operations, terminates the execution worker and its page-owned
regex/ERE workers, and drains filesystem cleanup before returning exit code 124.
It does not wait for the execution worker to acknowledge cancellation. Browser
worker construction or messaging failures never fall back to page execution.

The in-memory filesystem stays on the page. A bounded RPC interface preserves
acknowledged writes, hardlinks, byte contents, and filesystem error codes across
worker termination. Reads use pull-based streams; writes use the same guarded
empty-write/append sequence as the existing workspace policy. At most 64
filesystem requests and 64 read streams are admitted concurrently; at most four
auxiliary workers are owned by one execution. Remote stat identity scopes have
a 10,000-identity ceiling per execution. These bounds are not heap quotas.

Root cwd changes are sent as they occur, not only from final cleanup. After a
termination the page retains the last received cwd and recovers to a surviving
parent if needed. Subshell cwd does not overwrite the root state. Termination
does not roll back writes already admitted, and a subsequent command gets a
fresh worker using the surviving workspace. Variables/functions still do not
persist between commands.

Filesystem and UI work still run on the page, so this is not a guarantee that
every page operation remains responsive. A page-level timer itself can be
delayed by unrelated page work or browser scheduling. Worker termination is not
a hard browser heap/RSS boundary or universal out-of-memory containment.

## Platform references

- HTML Standard: <https://html.spec.whatwg.org/multipage/workers.html#dom-worker>
- Node worker resource limits: <https://nodejs.org/api/worker_threads.html#worker_threadsresourcelimits>
