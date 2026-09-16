# Format-neutral document AST

Scope: original TypeScript document model and validated package boundaries only.
No readers, writers, native fallback, safe-bash command changes or PDF layout.
Preserve the unrelated edits to pandoc-typescript-safe-bash.md.

## Implementation and QA

1. Write original expected-tree tests, then observe missing normalization failure.
2. Introduce exhaustive typed blocks, inlines, metadata and modern table tuples.
3. Bound traversal before constructor validation/cloning. Reject malformed trees,
   cycles, unsafe keys, invalid Unicode, nonfinite numbers and invalid table spans.
4. Validate at read/write/convert boundaries; reject unsupported typed math before
   writer invocation. Keep source positions and loss records as separate sidecars.
5. Run maintained pandoc workspace test, lint/typecheck and selected build closure.
6. Review owned diff and commit explicitly on main. No push/release authorized.

No CLI visual changes; no screenshot validation applies. Tests run entirely in
memory, with no filesystem mutations, fixtures, LLM or executable invocations.

Status: implementation and verification complete; included in the local AST commit.

Verified: maintained pandoc workspace tests (41 passing), lint including source and
original-test typechecks, selected workspace build closure, built public exports,
and owned diff whitespace checks. No ignored files staged. Unrelated pipeline
plan edits remain outside this commit. No remote delivery or release attempted.
