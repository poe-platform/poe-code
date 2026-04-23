---
$schema: https://poe-platform.github.io/poe-code/schemas/plans/pipeline.schema.json
kind: pipeline
version: 1

tasks:
  - id: workspace-deps
    title: Update workspace dependency names
    prompt: |
      All packages in the monorepo that depend on `agent-kit`, `agent-kit-schema`, or
      `agent-kit-openapi` as workspace dependencies must be updated to `toolcraft`,
      `toolcraft-schema`, and `toolcraft-openapi` respectively.

      Search all package.json files (excluding node_modules, dist) for references to
      "agent-kit", "agent-kit-schema", "agent-kit-openapi" in the dependencies,
      devDependencies, peerDependencies, and bundleDependencies fields, and replace with
      "toolcraft", "toolcraft-schema", "toolcraft-openapi".

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
    title: Update TypeScript import paths from agent-kit* to toolcraft*
    prompt: |
      Update all TypeScript/JavaScript source files that import from `agent-kit`,
      `agent-kit-schema`, or `agent-kit-openapi` to import from `toolcraft`,
      `toolcraft-schema`, or `toolcraft-openapi`.

      Key locations to check:
      - `packages/agent-kit/src/` — imports from `agent-kit-schema`
      - `packages/agent-kit-openapi/src/` — imports from `agent-kit` and `agent-kit-schema`
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

  - id: cmdkit-strings
    title: Remove all cmdkit string references from source code
    prompt: |
      Search for any remaining `cmdkit` string literals, Symbol descriptions, env var names,
      or identifiers in source files (TypeScript, JavaScript, config). Replace with `toolcraft`.

      Known occurrences to find:
      - `CMDKIT_FIXTURE` env var → `TOOLCRAFT_FIXTURE`
      - Symbol descriptions like `cmdkit.*` → `toolcraft.*`
      - CLI program name fallback `"cmdkit"` → `"toolcraft"`
      - Any test strings or snapshot values referencing cmdkit

      After replacing, update any snapshots with `npx vitest run --update-snapshots` if needed.
      Run tests to confirm.
    status:
      implement: done
      refactor: done
      test: done
      commit: done

  - id: rename-directories
    title: Rename package directories to match toolcraft names
    prompt: |
      Rename the three package directories:
      - `packages/agent-kit-schema` → `packages/toolcraft-schema`
      - `packages/agent-kit` → `packages/toolcraft`
      - `packages/agent-kit-openapi` → `packages/toolcraft-openapi`

      After renaming, update all references to these directory paths:
      - `turbo.json` if it has explicit package paths
      - `tsconfig.json` path aliases or references
      - `package.json` scripts that reference these directories by path
      - `.github/workflows/release-agent-kit.yml` — update `paths:` triggers and
        `working-directory:` and `cd packages/...` references; also rename the file to
        `release-toolcraft.yml`
      - `scripts/verify-agent-kit-standalone.mjs` — rename to `verify-toolcraft-standalone.mjs`
        and update internal paths
      - `scripts/bundle.mjs` — update any agent-kit path references
      - `tests/integration/standalone-package-metadata.test.ts` — update package name references
      - `package.json` workspace globs (if using explicit paths rather than `packages/*`)

      Run `npm install` to sync the lockfile, then `npx turbo run build` and `npx turbo run test:unit`.
    status:
      implement: done
      refactor: done
      test: done
      commit: open

  - id: update-docs
    title: Update docs — remove agent-kit and cmdkit mentions
    prompt: |
      Update living documentation (non-archive) to replace `agent-kit` and `cmdkit` with `toolcraft`.

      Files to update:
      - `docs/plans/agent-kit-release-notes.md` — update package names, install commands,
        migration table, binary name (`agent-kit-openapi-generate` → `toolcraft-openapi-generate`)
      - `packages/toolcraft/README.md`, `packages/toolcraft-schema/README.md`,
        `packages/toolcraft-openapi/README.md` — update any remaining `agent-kit` references
        in examples and body text
      - Any non-archive plan docs that reference agent-kit or cmdkit

      Archive docs under `docs/plans/archive/` can be left as historical record.

      Also rename `docs/plans/agent-kit-release-notes.md` to
      `docs/plans/toolcraft-release-notes.md` and update the content accordingly.
    status:
      implement: open
      refactor: open
      test: open
      commit: open
---

# Toolcraft rename

Remove all `cmdkit` and `agent-kit` mentions from the live codebase. The three packages were
renamed to `toolcraft`, `toolcraft-schema`, and `toolcraft-openapi` for publishing — this plan
propagates that rename through source imports, workspace dependencies, directory names, scripts,
workflow files, and living docs.

Archive docs under `docs/plans/archive/` are intentionally left untouched as historical record.

## Scope summary

| Area | Action |
|---|---|
| Workspace package.json deps | `agent-kit*` → `toolcraft*` |
| TypeScript imports | `from 'agent-kit*'` → `from 'toolcraft*'` |
| String literals / env vars | `cmdkit` → `toolcraft`, `CMDKIT_FIXTURE` → `TOOLCRAFT_FIXTURE` |
| Directory names | `packages/agent-kit*` → `packages/toolcraft*` |
| Workflow file | `release-agent-kit.yml` → `release-toolcraft.yml` |
| Scripts | `verify-agent-kit-standalone.mjs` → `verify-toolcraft-standalone.mjs` |
| Living docs | Update names, install commands, binary names |
