# Pandoc engine workspace revalidation

Scope: the requested private TypeScript engine workspace and public conversion
seam only. The workspace, exports, shared validation, orchestration and thin
safe-bash adapter already exist on main; preserve those implementations and
unrelated work. Do not recreate format readers or widen conversion scope.

## Executed procedure

1. Read root instructions and docs/pandoc/contract.md and architecture.md.
   No scoped AGENTS.md applies to the changed pandoc or documentation files.
2. Inspect private package declarations, strict ESM configuration, public exports,
   typed capabilities, ownership tests and shared Session validation. Confirm
   convert acquires inputs, aggregates documents, invokes the writer and publishes.
3. Add an original public-consumer regression for descriptor alias ownership;
   observe caller mutation changing advertised aliases despite stable lookup.
4. Copy and freeze alias maps and their direction arrays in registry snapshots.
5. Run maintained package unit and lint/typecheck routes and explicitly selected
   workspace build closure. Verify built ESM exports and real conversion in memory.
6. Validate maintained workspace build/unit discovery, review the owned diff and
   commit specific task files on main. No push or release is authorized.

## Status and gates

Local checks passed: 1,044 package unit tests, package lint/typecheck, selected
workspace build closure, built ESM consumer and workspace declaration discovery.
Evidence: docs/pandoc/workspace-descriptor-evidence.md and associated logs.
Unit regression mutates only in-memory arrays; no filesystem mutations, LLMs,
downloads or external executable calls. No CLI visual change occurs.

The required package README remains absent. Exact proposed copy is already in
docs/pandoc/package-readme-draft.md and must not be applied without explicit
permission. Package delivery is incomplete while this publication gate is open.
No README files changed. This revalidation does not claim full conversion-contract
acceptance, remote-main delivery or a release.
