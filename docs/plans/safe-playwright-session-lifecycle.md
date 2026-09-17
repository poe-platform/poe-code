# Injected Playwright session lifecycle

Implement only the qualified lifecycle subset in `@poe-platform/safe-bash`:
`open [URL]`, `goto URL`, `list`, `close`, and `close-all`. Registration and byte
output belong to `poe-code/safe-bash/commands/playwright`. Shell pipelines and
redirects use the canonical filesystem without passing guest paths to Playwright.
The original adapter import remains a compatibility entry. Existing billing
interfaces remain available; no reporting timers, metering, or charging run.

## Public configuration

`createPlaywrightCli` returns `{ plugin, dispose }`; install the plugin explicitly
with `shell.use(controller.plugin)`. `agentCommands` never registers it.
`createPlaywrightController` exposes `run(invocation)` for hosts and SDK consumers.
Public root imports are `@poe-platform/safe-bash/playwright` and
`poe-code/safe-bash/commands/playwright`; the controller ships in the existing Safe Bash package as an explicit chunk.

- `adapter` is required. Its `browsers` map declares supported `chromium`, `firefox`,
  and `webkit` engines and their actual headed capability. The default engine is
  `chromium`; absence fails explicitly rather than selecting another engine.
- `limits.maxSessions` defaults to 4 and is a positive safe integer. Capacity
  includes acquisition and retirement and is reserved before host acquisition.
- `limits.actionTimeoutMs` defaults to 30000 and is a positive safe integer passed
  to each supported navigation call. Trusted hosts must honor the declared policy.
- `replace` defaults to false and controls command registration collision policy.
  It belongs only to the shell factory.
- `billing` is unavailable on the controller; a supplied value is rejected.
  Exported reporting-capability and billing declarations describe future injection
  obligations in the existing `packages/safe-bash/src/contracts/playwright.md`.
- Other configuration/limits and command options are rejected before acquisition.

Only the exported invocation variable `PLAYWRIGHT_CLI_SESSION` is read. Selection
is explicit `-s NAME`, `-s=NAME`, `--session NAME`, or `--session=NAME`, then that
exported variable, then `default`. Names contain 1–128 ASCII letters, digits,
underscores or hyphens and are identifiers, never paths. `open` accepts
`--browser ENGINE`/`--browser=ENGINE` and `--headed`/`--headless` (headless default).
Navigation accepts absolute HTTP/HTTPS URLs and `about:blank`. Unsupported flags,
engines and modes fail before browser effects; no native CLI or implicit credentials
are used. This subset does not claim upstream snapshot/ref or full CLI parity.

`createPlaywrightAdapter` accepts an engine map of `{ headed?, acquireBrowser }`.
The trusted callback receives acquisition identity, session name, exact engine,
headless policy and cooperative signal. It returns `{ browser, release }` and
owns partial-acquisition cleanup before returning. The adapter creates an isolated
context and retires that context before calling the host resource release hook.
An owned release may terminate its browser or detach/return a connection or pool
resource; a borrowed-browser release must never kill the browser. No browser
`close()` is assumed. Browser network authorization belongs to the injected host.

## Ownership and failure policy

The host owns one controller per workspace/tenant/application lifecycle. Dispose
it at owner shutdown. A stateless Worker must scope it to one execution; an
in-memory registry provides no persistence across independent requests, eviction,
or deployment. A durable session owner requires separate deployment qualification.
Transport loss invalidates live page objects and requires explicit reopen. It is
not proof of remote browser termination; host reconciliation remains required.
No navigation or other action is automatically replayed after loss.

Per-session queues permit independent sessions to run concurrently. Each session
generation moves through acquiring, open, closing and closed. Notifications are
bound to their own generation and cannot close replacements. `close-all` includes
previously admitted opens and snapshots its target names; later unrelated opens
are allowed. Failed cleanup is reported and an affected name cannot reopen through
its rejected retirement completion.

Invocation cleanup is registered synchronously before admission. Successful open
transfers its lease only after awaited output publication. Completed commands and
later cancellation of their old command signals retain controller-owned sessions.
Failed or cancelled acquisition drains late resources. Active cancellation retires
its context; queued cancellation does not kill a preceding operation. Cancellation
cannot undo completed navigation or forcibly terminate opaque, uncooperative host
work. Acquisition and action promises are observed and drained. Disposal closes
admission synchronously, releases owned contexts, drains admitted work, and shares
one completion promise, including failure. Cleanup failures preserve execution
causes and never imply confirmed remote termination.

## Validation and visual QA

Use fake injected contexts and memfs to verify session selection through the real
shell, pipeline output and canonical virtual redirects. Cover unsupported inputs
without effects, all states, capacity during acquisition/concurrent reopen,
serialization, cancellation, late resources, generation replacement, remote loss,
output failure, and disposal. Retain the existing borrowed-browser qualification
cases. Build only the focused workspace and the maintained @poe-platform/safe-bash closure;
run package unit tests, the maintained @poe-platform/safe-bash runner, source/public-consumer
typechecks, and the guarded root ESLint route.

Execute visual QA by rendering actual shell output for open, list, goto, close-all,
a closed-session error and an unsupported-engine error with the maintained screenshot
renderer; inspect the resulting PNG. Purge generated evidence afterward. Absolute
`/out` is read-only on this host, so temporary screenshot evidence uses checkout
`out/`. No README is created or changed because the user explicitly prohibited it.
