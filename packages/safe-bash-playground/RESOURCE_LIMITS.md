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

## Main-page execution

The shell currently executes on the page. Its five-second timer requests
cooperative cancellation; synchronous work can prevent the timer from running.
Moving shell execution off the page is tracked separately in issue 627. The
regex/ERE worker disclosure does not resolve that execution-placement issue.

## Platform references

- HTML Standard: <https://html.spec.whatwg.org/multipage/workers.html#dom-worker>
- Node worker resource limits: <https://nodejs.org/api/worker_threads.html#worker_threadsresourcelimits>
