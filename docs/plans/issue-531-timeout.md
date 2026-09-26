# Issue 531: kill-after execution boundary

The Node public Shell supplies a worker execution boundary for active kill-after
requests. Standard agent command configurations are replayed from enrolled
recipes, not inferred from command names. Explicit worker modules admit custom
commands and extensions. A worker must reproduce the admitted command inventory.
Portable/custom hosts must supply their own truthful policy; unsupported active
escalation is refused before invoking a child. Zero duration and zero kill-after
retain their existing meanings.

The controller owns deadlines, signal dispositions, worker termination and the
filesystem/stream bridge. It closes bridge admission before killing the worker
and waits for admitted host operations. Completed filesystem effects are retained.
Raw argument bytes cross the boundary without source interpolation. This is a
virtual execution boundary, not a host-program or POSIX process-group fallback.

## QA

1. Run maintained focused timeout tests. Require reported test totals with no
   cancellations or timeouts. Exercise TERM-ignore, an event-loop-blocking command,
   default TERM status, preserve-status, raw byte arguments and parent cancellation.
   Verify filesystem quotas retain their parent invocation owner under concurrent
   shells and device access, and preserve an explicitly provided device namespace.
   Require finite substitution-depth refusal before leaked child output, and
   additional live descriptor refusal before child start. Keep ordinary no-k
   descriptor and depth controls to establish the admitted semantics.
2. Use the actual public Shell with memory, an explicitly rooted real filesystem,
   S3 mock transport, and WebDAV over loopback HTTP. Put `Changed12\r\n` in
   `Changed input.txt`. Compare all four kill-after spellings with GNU timeout for
   `cat` and an immediate exit-9 child. Verify file bytes and unchanged metadata.
   Native oracle files, transient output and evidence belong to owned `/out` paths.
3. On each backend, run a child ignoring TERM until hard escalation; require 137.
   Verify the filesystem is stable after settlement and the shell remains usable.
   Qualify the loopback and mock profiles explicitly; they do not certify services.
4. Run the maintained build and test graph, lint and strict consumer routes. A
   normal exit and fresh graph completion are required. Do not count interrupted
   or cache-publication-failed runs as successful validation.
5. Verify the built workspace and packaged consumer can locate and execute the
   worker entry without source loaders. Run the same expiry and immediate-output
   controls through those public imports.
6. Commit only owned changes, rebase as necessary, push main, verify the delivered
   commit on remote main, then record completion against each issue requirement.
   Close issue 531 only after all required evidence is complete.
