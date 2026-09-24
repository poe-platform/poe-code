# Restricted yq module

This optional module implements the frozen restricted YAML 1.2.2 Core-profile
reader and deterministic formatter over the existing bounded jq interpreter.
It is not Mike Farah yq syntax or a full YAML implementation. It has no runtime
dependency, native fallback, host-process execution, implicit registration,
write mode, slurp, or eval-all mode.

The module exports `createYqCommand()`, `createYqCommands()`, and
`yqCommands({ replace?, limits? })` from `src/commands/yq/index.ts`. Root/package exports
and default aggregate registration are deliberately outside this module's
ownership. The private query adapter is `src/commands/structured/query-core.ts`.

Hosts can set finite nonnegative integer `limits`: `maxAliasReferences` (default
1,024 per invocation), `maxDocumentNodes` (16,384 expanded nodes per document),
`maxValueBytes` (8 MiB per document), and `maxSteps` (1,000,000 shared work units
per invocation). These budgets apply before query selection, including values
that the filter never selects. Alias projections and clone work are admitted
before cloning; limit failures return status 5. Limits are captured when the
command is created and cannot be changed by shell arguments.

Input and output documents are wholly retained within logical byte,
node, depth, collection, result, and output admissions. YAML source scanning
retains at most 65,536 physical lines per parser input, including blank lines,
comments, directives and document markers; exceeding this quota returns status
5 with `LIMIT_MAX_SOURCE_LINES`. CRLF counts as one line break. Scanning charges
the invocation work budget and checks cancellation before retaining line data.
Those admissions do not
claim an aggregate heap/RSS/CPU/latency bound or preemption of provider or query
engine internals. Query compilation and bounded interpreter internals retain
their documented synchronous qualifications. Supplied-signal VFS and sink work
is awaited; completed sink effects cannot be rolled back.
