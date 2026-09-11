# Raw host callback receiver preservation

Five tests failed before repair: ordinary and Proxy callbacks lost their receiver,
including receiver/argument identity and a completed replay workflow.

Use a normal strict host wrapper instead of an arrow. Import the receiver and
arguments together so shared references remain shared. Invoke the guest closure
or Proxy with that receiver. When present, retain the receiver as the first value
in the recorded invocation graph and mark the callback hasReceiver. Do not encode
it separately from arguments, which would lose aliases.

Host replay serialization selects version 2 only when receiver-bearing callbacks
exist; argument-only records keep their version-1 encoding. The reader accepts
both versions, rejects receiver flags in version 1, rejects invalid flags and
missing/undefined encoded receivers, and compares receiver presence and the
whole invocation graph when a pending operation is re-issued. Older readers
reject the new version instead of mistaking its receiver for an argument.

Sixteen focused tests pass: native value/alias comparisons, Proxy traps, primitive
receivers, completed replay without repeated host effects, malformed records,
legacy argument-only records, and unchanged/changed pending re-issue receivers.
The pending tests use the maintained replay snapshot backend. An initial attempt
to dump a portable heap during an active callback hit the running-object guard;
that route is not claimed fixed by this change.

The broader callback/journal/replay selection passed 265 tests across 11 files.
Scoped ESLint and package TypeScript passed. The maintained closure passed
23 builds and all four fresh-process import checks. Full-package verification predates this change
and still has two unresolved host-Promise import-policy failures.

README updated. No CLI presentation changes. Pushes and releases remain held.
