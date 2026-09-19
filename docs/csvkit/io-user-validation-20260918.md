# User I/O edge validation

This pass used the existing frozen 2.2.0 I/O observations rather than claiming
new native measurements. An independent agent replayed all 19 observations
with streamed named files and stdin, one byte per chunk and interleaved empty
chunks. Exact stdout, stderr, status and unchanged in-memory file effects were
checked through the domain engine and the actual safe-bash Shell.

A new failing original regression demonstrated that a named producer's failing
`return()` replaced an already raised field-size parser diagnostic. Runtime
record iteration now observes and awaits that cleanup while retaining the
primary parser failure. The success path continues to report producer cleanup
failures. Tests include a partial-output Shell case: the completed header
survives, the diagnostic is retained and the producer closes exactly once.

Domain tests pass 368/368; the two focused Shell files pass 72/72. Domain ESLint and production/test TypeScript checks
pass. The maintained uncached safe-bash build closure passes all ten selected
workspace builds. The maintained safe-bash source/test and 26 consumer-group
typechecks pass. The compiled public Shell reproducer was rendered and its
diagnostic screenshot inspected; the original parser message and status 1 were
readable. Temporary screenshot evidence was removed after inspection.

The unchanged blockers in io-validation.md and implementation-status.md remain
explicit: this is not all-edge-case coverage or complete csvkit compatibility.
No README, staging, commit, push or release action was performed.
