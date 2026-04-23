---
$schema: https://poe-platform.github.io/poe-code/schemas/plans/pipeline.schema.json
kind: pipeline
version: 1

tasks:
  - id: workspace-deps
    title: Normalize workspace dependency names
    prompt: |
      All packages in the monorepo that depend on the standalone command packages must use
      `toolcraft`, `toolcraft-schema`, and `toolcraft-openapi` in workspace dependency fields.

      Search all package.json files (excluding node_modules, dist) for dependency,
      devDependency, peerDependency, and bundleDependency entries that still use outdated
      names, and update them to the published `toolcraft*` package names.

      Also check the root package.json for any workspace or script references.

      Do not change the package directory names yet — only the names referenced in
      package.json dependency fields.

      Run `npm install` after to update the lockfile.
    status:
      implement: done
      refactor: done
      test: done
      commit: done

  - id: source-imports
    title: Normalize TypeScript import paths to toolcraft*
    prompt: |
      Update all TypeScript/JavaScript source files so they import from `toolcraft`,
      `toolcraft-schema`, and `toolcraft-openapi`.

      Key locations to check:
      - `packages/toolcraft/src/` — imports from `toolcraft-schema`
      - `packages/toolcraft-openapi/src/` — imports from `toolcraft` and `toolcraft-schema`
      - `packages/github-workflows/src/`
      - `packages/markdown-reader/src/`
      - `packages/superintendent/src/`
      - `packages/terminal-pilot/src/`
      - `packages/terminal-pilot-mcp/src/`
      - `packages/ralph/src/`
      - `packages/experiment-loop/src/`
      - `src/cli/`

      Use grep to find all occurrences first, then update. Run `npx turbo run build` and
      `npx turbo run test:unit` after to confirm nothing is broken.
    status:
      implement: done
      refactor: done
      test: done
      commit: done

  - id: toolcraft-strings
    title: Normalize string references to toolcraft
    prompt: |
      Search for any remaining outdated string literals, Symbol descriptions, env var names,
      or identifiers in source files (TypeScript, JavaScript, config). Replace them with the
      current `toolcraft` naming.

      Known occurrences to verify:
      - fixture env var should be `TOOLCRAFT_FIXTURE`
      - Symbol descriptions should use `toolcraft.*`
      - CLI program name fallback should be `"toolcraft"`
      - tests and snapshots should reference `toolcraft`

      After replacing, update any snapshots with `npx vitest run --update-snapshots` if needed.
      Run tests to confirm.
    status:
      implement: done
      refactor: done
      test: done
      commit: done

  - id: rename-directories
    title: Ensure package directories match toolcraft names
    prompt: |
      Ensure the three standalone package directories use the published names:
      - `packages/toolcraft-schema`
      - `packages/toolcraft`
      - `packages/toolcraft-openapi`

      Update all references to these directory paths:
      - `turbo.json` if it has explicit package paths
      - `tsconfig.json` path aliases or references
      - `package.json` scripts that reference these directories by path
      - `.github/workflows/release-toolcraft.yml` — update `paths:` triggers,
        `working-directory:`, and `cd packages/...` references
      - `scripts/verify-toolcraft-standalone.mjs` — confirm internal paths match
      - `scripts/bundle.mjs` — update any package path references
      - `tests/integration/standalone-package-metadata.test.ts` — update package name references
      - `package.json` workspace globs (if using explicit paths rather than `packages/*`)

      Run `npm install` to sync the lockfile, then `npx turbo run build` and `npx turbo run test:unit`.
    status:
      implement: done
      refactor: done
      test: done
      commit: done

  - id: update-docs
    title: Update docs — use toolcraft naming everywhere
    prompt: |
      Update living documentation (non-archive) so it consistently uses the `toolcraft` package family.

      Files to update:
      - `docs/plans/toolcraft-release-notes.md` — update package names, install commands,
        migration table, and binary name (`toolcraft-openapi-generate`)
      - `packages/toolcraft/README.md`, `packages/toolcraft-schema/README.md`,
        `packages/toolcraft-openapi/README.md` — keep examples and body text aligned with
        current package names
      - Any non-archive plan docs that still use outdated naming

      Archive docs under `docs/plans/archive/` can be left as historical record.
    status:
      implement: done
      refactor: done
      test: done
      commit: done
---

# Toolcraft rename

Keep the live codebase aligned on the `toolcraft`, `toolcraft-schema`, and `toolcraft-openapi`
package names. This plan covers source imports, workspace dependencies, directory names, scripts,
workflow files, and living docs.

Archive docs under `docs/plans/archive/` are intentionally left untouched as historical record.

## Scope summary

| Area | Action |
|---|---|
| Workspace package.json deps | Use `toolcraft*` package names |
| TypeScript imports | Import from `toolcraft*` packages |
| String literals / env vars | Use `toolcraft` names and `TOOLCRAFT_FIXTURE` |
| Directory names | Use `packages/toolcraft*` directories |
| Workflow file | Use `release-toolcraft.yml` |
| Scripts | Use `verify-toolcraft-standalone.mjs` |
| Living docs | Use current names, install commands, and binary names |
