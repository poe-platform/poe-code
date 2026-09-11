# Issue 627: move playground shell execution off the page

Author: kamilio. Status: implemented and validated; direct-main delivery next.

## Validated boundary

`createSession` constructs the pinned Shell on the page, and `run` directly
awaits its `exec` method. A page timer aborts after five seconds but cannot run
during synchronous shell work. Existing source and browser help explicitly
confirm cooperative cancellation; a worker must own execution rather than
merely wrapping the same page call in a promise.

## Implementation scope

- Keep the pinned engine, registered commands, help, completion, workspace
  budgets, and existing editor/upload/download behavior.
- Execute each command in a dedicated worker. A page-owned five-second deadline
  terminates execution without waiting for a worker acknowledgement. Fail closed
  on construction, bootstrap, message, or worker errors; never fall back to page
  execution.
- Keep the in-memory filesystem on the page, exposing only an explicit bounded
  filesystem RPC surface. This preserves acknowledged writes across termination
  without inventing rollback, disk persistence, or lossy file snapshots.
- Preserve filesystem error codes, stat identity, optional capabilities, and
  pull-based stream cleanup. Stop admitting operations before termination, abort
  admitted operations, and drain their cleanup before the next command.
- Own auxiliary regex/ERE worker handles on the page too, so terminating the
  execution worker cannot strand workers or blob URLs.
- Persist the last acknowledged root cwd; recover it against the surviving
  filesystem after termination. Do not infer cwd from arbitrary filesystem calls.
- Bound startup and pending requests; reject late messages from completed runs.
  Fresh command workers naturally reset shell variables/functions as before.

## TDD and validation

First reproduce the current page fallback with a regression asserting that a
failed dedicated-worker constructor cannot execute a command locally. Cover
deadline termination, blocked synchronous execution, subsequent command recovery,
preserved writes/cwd, stream finalization, worker errors, bounded requests, stale
messages, and auxiliary-worker cleanup. Exercise the real pinned engine across
the RPC boundary, not only a fake worker.

Run maintained playground unit/build checks, guarded repository lint, and real
browser smoke commands with screenshots. Check help, pipelines/redirection,
regex/ERE, hardlinks, editing/upload/download, completion, and reset. Keep
hard-heap/OOM and all-page-work isolation claims out of the documentation: the
page still owns filesystem/UI work, and browser workers expose no heap cap.

Pull/rebase upstream main before the normal direct-main push. Verify remote
delivery, close issue 627 immediately, and monitor publication separately.

## Executed evidence

- Fresh regression demonstrated that blocking Worker construction still allowed
  page-side shell execution and filesystem writes. The new worker-only path
  rejects that run without executing the command.
- Real pinned-engine session tests cross an actual worker/structured-clone
  boundary. They exposed lost cwd on hard termination; incremental root-cwd
  notifications fix it while preserving the existing once-only final-state
  callback. Existing child/subshell/pipeline cwd assertions remain unchanged.
- A real worker running a synchronous infinite loop is terminated by the page
  deadline without blocking a page timer; a fresh worker then executes normally.
  Fake-clock controls separately cover startup timeout, stale messages, worker
  errors, auxiliary-worker termination, and retained acknowledged writes.
- Filesystem tests cover binary bytes, hardlink identity, optional capabilities,
  bounded admission, stream pull/return, producer cleanup, cancellation/draining,
  error codes and exact filesystem error context. A malformed-result regression
  and an error-message/context regression were observed failing before fixes.
- Production browser smoke passed help, pipelines, regex/ERE, hardlinks, actual
  five-second timeout (124), subsequent execution with retained file/cwd, editor
  save through a hardlink, path completion, and reset. Inspected help and timeout
  screenshots; the isolated browser session was closed and confirmed absent.
- Download was invoked, but the browser service reported download inspection
  unavailable; no download-content or native-upload UI claim is made. Existing
  session tests continue to verify upload limits and download/read byte fidelity.
- Test-only Node worker fixtures live outside production `src` so the browser
  TypeScript build does not require Node globals.
- Final maintained playground unit route: 164 tests across eight files passed.
  The maintained browser TypeScript and production-site build also passed.
- Guarded repository ESLint, root TypeScript checks, and workflow lint passed
  after rebasing upstream changes confined to SafeJS and its plans. No playground
  engine pin or dependency versions changed.
