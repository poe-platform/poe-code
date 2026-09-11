# Job-owned weak targets and external notices

WeakRef target retention belongs to the execution job, not a native microtask:
interpreter-internal host awaits must not release it, while guest suspension and
abrupt completion must. Each job now keeps a deduplicated target set per budget,
registers it as a retained-data source, and releases every source before another
job starts. Async prefixes attach targets to their owning execution job.

External finalization notices must enter the queue and resource context captured
at registration, without overlapping an active guest job. The scheduler captures
the async context as well as the queue. Tests cover ordering, error recovery and
the registering resource context. Earlier failing tests (43258 and 82165) exposed
the missing scheduler and resource-context propagation; isolated verification
before this commit checks these additions without the unfinished registry code.

This is internal job infrastructure, not a declaration that WeakRef or
FinalizationRegistry is complete. Their public bindings, heap integration and
older-runtime symbol limitations remain separate work. No release is authorized.

Verification: all 1,322 tracked source/test blobs in the isolated candidate match
staged tree 9192d77c9a36ecc81ee46356a4775f9914491f49. The five-file job/realm
selection passes all 74 tests (64518). Package TypeScript (92728) and scoped
ESLint (25745) pass. The separate working-tree full-package run is not evidence
for this isolated commit and its result remains pending.
