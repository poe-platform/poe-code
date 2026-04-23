---
$schema: https://poe-platform.github.io/poe-code/schemas/plans/pipeline.schema.json
kind: pipeline
version: 1

tasks:
  - id: naming-map-and-impact-audit
    title: Lock the rename map and audit impact
    prompt: |
      Prepare the package rename/publish migration for this repo.

      Required target naming:
      - existing workflow/runtime package currently named `@poe-code/agent-kit` must be renamed to `@poe-code/agent-harness-tools`
      - existing cmdkit package must become `agent-kit`
      - existing cmdkit-schema package must become `agent-kit-schema`
      - existing cmdkit-openapi package must become `agent-kit-openapi`

      Audit and document the exact impact before changing implementation:
      - package names in `package.json` files
      - workspace dependency references in package manifests
      - source imports and test imports
      - root-package subpath exports and published-files list
      - build/bundle scripts
      - generated code strings and snapshots that currently emit `@poe-code/cmdkit*`
      - package-lock / pnpm-lock fallout
      - any assumptions in docs/plans or templates that point at `packages/agent-kit`

      Produce a concrete migration map that keeps responsibilities clean:
      - workflow/runtime helpers stay in the renamed `agent-harness-tools`
      - command DSL/schema/openapi packages take over the `agent-kit*` names for standalone publishing

      Acceptance criteria:
      - no ambiguous naming decisions remain
      - all required file groups and risky compatibility points are listed before implementation begins
    status:
      implement: done
      refactor: done
      test: done
      commit: open

  - id: rename-workflow-agent-kit
    title: Rename existing agent-kit package
    prompt: |
      Rename the existing workflow/runtime package from `@poe-code/agent-kit` to `@poe-code/agent-harness-tools`.

      Scope:
      - package directory if needed
      - package.json name
      - all internal imports and dependency references
      - tests, fixtures, templates, and hard-coded cwd/path references that currently use `packages/agent-kit`
      - any root workspace metadata affected by the rename

      Constraints:
      - do not change runtime behavior beyond the rename
      - preserve the current package public API under its new package name
      - do not add provider-specific branching
      - keep changes minimal and declarative

      Testing expectations:
      - add/update targeted tests first where practical
      - run the affected package tests plus representative downstream consumers (`pipeline`, `ralph`, `experiment-loop`, `superintendent`, CLI commands importing the package)
      - fix lockfile/workspace resolution cleanly
    status:
      implement: done
      refactor: done
      test: open
      commit: open

  - id: rename-cmdkit-family
    title: Rename cmdkit packages to agent-kit family
    prompt: |
      Rename the command-stack packages for standalone publishing:
      - `@poe-code/cmdkit` -> `agent-kit`
      - `@poe-code/cmdkit-schema` -> `agent-kit-schema`
      - `@poe-code/cmdkit-openapi` -> `agent-kit-openapi`

      Apply the rename consistently across:
      - package names and dependency edges
      - import paths in source and tests
      - generated output strings emitted by `packages/cmdkit-openapi`
      - snapshots and compile-check files
      - root `poe-code` exports/subpath compatibility if still needed for existing consumers

      Constraints:
      - the command DSL and schema APIs should stay functionally equivalent
      - preserve CLI/MCP/SDK parity
      - do not introduce temporary wrapper layers that only proxy calls

      Acceptance criteria:
      - repo builds against the new names
      - generated OpenAPI clients import `agent-kit` / `agent-kit-openapi`, not the old cmdkit names
      - no stale source imports remain
    status:
      implement: done
      refactor: done
      test: open
      commit: open

  - id: standalone-publish-prep
    title: Prepare standalone package publishing
    prompt: |
      Prepare the renamed packages for standalone npm publishing rather than shipping them indirectly through `poe-code`.

      Required outcomes:
      - publishing metadata is correct on the three standalone packages (`agent-kit`, `agent-kit-schema`, `agent-kit-openapi`)
      - `agent-kit-openapi` exposes a working `agent-kit-openapi-generate` binary from its own package
      - package exports, files, main/types/bin fields, and dependency declarations are valid for external consumers
      - remove or avoid root-package hacks whose only purpose was to tunnel these packages through `poe-code`

      Check for missing publish blockers:
      - `private: true`
      - package names not matching target public names
      - README/package metadata gaps
      - dependency declarations that only work in-workspace
      - tarball contents missing dist/bin/type files

      Acceptance criteria:
      - `npm pack` for each standalone package produces a usable tarball
      - a fresh throwaway consumer can install the tarballs and run the generator without depending on `poe-code`
    status:
      implement: done
      refactor: open
      test: open
      commit: open

  - id: publish-smoke-and-cleanup
    title: Validate publish flow and clean compatibility edges
    prompt: |
      Validate the end-to-end rename and standalone publish flow.

      Required verification:
      - targeted unit tests for renamed packages
      - root typecheck/lint where impacted
      - tarball smoke tests for `agent-kit`, `agent-kit-schema`, and `agent-kit-openapi`
      - a real consumer-style smoke test that installs packed tarballs, runs the OpenAPI generator, and confirms generated code resolves package imports

      Also clean up compatibility edges:
      - ensure root `poe-code` exports still make sense after the standalone split
      - update lockfiles and snapshots deterministically

      Final deliverable:
      - repo state ready for standalone package publishing
      - concise release notes listing renamed packages, migration path from old names, and any consumer breaking changes
    status:
      implement: open
      refactor: open
      test: open
      commit: open
---

# Context

User request:

- read `~/.codex/skills/poe-code-pipeline-plan/SKILL.md`
- make a plan
- rename the existing `agent-kit` package here to something else, e.g. `agent-harness-tools`
- rename the cmdkit family to:
  - `agent-kit`
  - `agent-kit-schema`
  - `agent-kit-openapi`
- then prepare those packages for standalone publishing

Relevant repo facts gathered before writing this plan:

- Pipeline plan directory resolves to `docs/plans`
- Project pipeline steps come from `.poe-code/pipeline/steps.yaml` with steps:
  - `implement`
  - `refactor`
  - `test`
  - `commit`
- Current workflow/runtime package is `packages/agent-kit` named `@poe-code/agent-kit`
- Current command stack packages are:
  - `packages/cmdkit` named `@poe-code/cmdkit`
  - `packages/cmdkit-schema` named `@poe-code/cmdkit-schema`
  - `packages/cmdkit-openapi` named `@poe-code/cmdkit-openapi`
- There are many direct source/test/package references to both `@poe-code/agent-kit` and the `@poe-code/cmdkit*` family, so this is a broad rename with publish-surface impact
- There are currently local WIP changes around exposing an OpenAPI generator through the root `poe-code` package; the intended direction from this request is to avoid that workaround and instead make the renamed command-stack packages publishable as standalone packages

Expected migration intent:

- keep the current workflow helper package but move it to a less collision-prone name (`agent-harness-tools`)
- give the simpler `agent-kit*` names to the command-definition/schema/openapi packages intended for standalone publishing
- validate through packed-tarball smoke tests instead of relying on in-repo workspace resolution

## Locked migration map

These names and ownership boundaries are now fixed for implementation:

| Current directory | Current package name | Target directory | Target package name | Responsibility |
| --- | --- | --- | --- | --- |
| `packages/agent-kit` | `@poe-code/agent-kit` | `packages/agent-harness-tools` | `@poe-code/agent-harness-tools` | workflow/runtime helpers only |
| `packages/cmdkit` | `@poe-code/cmdkit` | `packages/agent-kit` | `agent-kit` | command DSL + CLI/MCP/SDK surface |
| `packages/cmdkit-schema` | `@poe-code/cmdkit-schema` | `packages/agent-kit-schema` | `agent-kit-schema` | schema DSL + schema export helpers |
| `packages/cmdkit-openapi` | `@poe-code/cmdkit-openapi` | `packages/agent-kit-openapi` | `agent-kit-openapi` | OpenAPI generator/runtime helpers |

Locked specifier map:

- `@poe-code/agent-kit` -> `@poe-code/agent-harness-tools`
- `@poe-code/cmdkit` -> `agent-kit`
- `@poe-code/cmdkit/cli` -> `agent-kit/cli`
- `@poe-code/cmdkit/mcp` -> `agent-kit/mcp`
- `@poe-code/cmdkit/sdk` -> `agent-kit/sdk`
- `@poe-code/cmdkit-schema` -> `agent-kit-schema`
- `@poe-code/cmdkit-openapi` -> `agent-kit-openapi`

Locked CLI/generator naming:

- standalone package bin becomes `agent-kit-openapi-generate`
- generated file banner becomes `Generated by agent-kit-openapi.`
- generated imports use `agent-kit` and `agent-kit-openapi`
- `cmdkit-openapi` user-facing strings (`.cmdkit-openapi`, salt text, help text, error text) move to `agent-kit-openapi`

Locked root-package decision:

- `poe-code` stops being the publish tunnel for the command-stack packages
- do **not** add new root `./agent-kit*` subpath exports
- remove root-only `cmdkit` / `cmdkit-openapi` publish workarounds once the standalone packages pack correctly

## Exact impact audit before implementation

### 1. Package names in `package.json` files

Direct package-name changes required:

- `packages/agent-kit/package.json`
- `packages/cmdkit/package.json`
- `packages/cmdkit-schema/package.json`
- `packages/cmdkit-openapi/package.json`

Root manifest fallout in `package.json`:

- root `devDependencies` currently reference all four old names:
  - `@poe-code/agent-kit`
  - `@poe-code/cmdkit`
  - `@poe-code/cmdkit-schema`
  - `@poe-code/cmdkit-openapi`
- root `bin`, `exports`, `files`, and `build` behavior currently assume `cmdkit*` still ship through `poe-code`

### 2. Workspace dependency references in package manifests

Package-manifest dependency edges that must be renamed:

- root `package.json`
  - `devDependencies.@poe-code/agent-kit`
  - `devDependencies.@poe-code/cmdkit`
  - `devDependencies.@poe-code/cmdkit-schema`
  - `devDependencies.@poe-code/cmdkit-openapi`
- `packages/cmdkit/package.json`
  - `dependencies.@poe-code/cmdkit-schema`
- `packages/cmdkit-openapi/package.json`
  - `dependencies.@poe-code/cmdkit`
- `packages/experiment-loop/package.json`
  - `dependencies.@poe-code/agent-kit`
- `packages/github-workflows/package.json`
  - `dependencies.@poe-code/cmdkit`
  - `dependencies.@poe-code/cmdkit-schema`
- `packages/markdown-reader/package.json`
  - `dependencies.@poe-code/cmdkit`
  - `dependencies.@poe-code/cmdkit-schema`
- `packages/pipeline/package.json`
  - `dependencies.@poe-code/agent-kit`
- `packages/ralph/package.json`
  - `dependencies.@poe-code/agent-kit`
- `packages/superintendent/package.json`
  - `dependencies.@poe-code/agent-kit`
  - `dependencies.@poe-code/cmdkit`
- `packages/terminal-pilot/package.json`
  - `devDependencies.@poe-code/cmdkit`
  - `devDependencies.@poe-code/cmdkit-schema`
- `packages/terminal-pilot-mcp/package.json`
  - `dependencies.@poe-code/cmdkit`

### 3. Source imports and test imports

#### 3a. Runtime/workflow package rename (`@poe-code/agent-kit` -> `@poe-code/agent-harness-tools`)

Source imports:

- `packages/experiment-loop/src/discovery/discovery.ts`
- `packages/experiment-loop/src/run/loop.ts`
- `packages/experiment-loop/src/testing/simulation.ts`
- `packages/experiment-loop/src/types.ts`
- `packages/pipeline/src/lock/lock.ts`
- `packages/pipeline/src/run/pipeline.ts`
- `packages/ralph/src/discovery/discovery.ts`
- `packages/ralph/src/run/ralph.ts`
- `packages/ralph/src/testing/simulation.ts`
- `packages/superintendent/src/commands/install.ts`
- `packages/superintendent/src/commands/run.ts`
- `packages/superintendent/src/runtime/loop.ts`
- `packages/superintendent/src/testing/simulation.ts`
- `src/cli/commands/experiment.ts`
- `src/cli/commands/pipeline-init.ts`
- `src/cli/commands/pipeline.ts`
- `src/sdk/experiment.ts`

Test imports:

- `packages/pipeline/src/pipeline.test.ts`
- `src/cli/commands/experiment-ralph.test.ts`
- `src/cli/commands/pipeline-command.test.ts`

#### 3b. Command-stack rename (`@poe-code/cmdkit*` -> `agent-kit*`)

High-impact source import groups:

- command-stack self-imports
  - `packages/cmdkit/src/{index,cli,mcp,sdk,number-schema,schema-scope}.ts`
  - `packages/cmdkit-openapi/src/{api-command,define-client,generate,http,interpreter,naming,runtime,spec-source}.ts`
  - `packages/cmdkit-openapi/src/auth/{bearer-token-auth,types}.ts`
  - `packages/cmdkit-openapi/src/bin/generate.ts`
- downstream package sources
  - `packages/github-workflows/src/{commands,preflight,setup-agent}.ts`
  - `packages/github-workflows/src/exec/{check-user-allow,require-comment-prefix}.ts`
  - `packages/markdown-reader/src/core/{document,resolve}.ts`
  - `packages/markdown-reader/src/mcp/{group,run,tools}.ts`
  - `packages/superintendent/src/{cli,mcp}.ts`
  - `packages/superintendent/src/commands/{builder-group,complete,inspector-group,install,plan-path,run,superintendent-group}.ts`
  - `packages/terminal-pilot-mcp/src/index.ts`
  - `packages/terminal-pilot/src/cli.ts`
  - `packages/terminal-pilot/src/commands/*.ts`
  - `src/cli/program.ts`

High-impact tests / compile checks / snapshots:

- `packages/cmdkit/src/{cli.compile-check,cli.test,cmdkit.test,index.compile-check,mcp.compile-check,sdk.compile-check}.ts`
- `packages/cmdkit-schema/src/index.test.ts`
- `packages/cmdkit-openapi/src/{bearer-token-auth,define-client,generate-cli,generate,generated-array-cli,http,index,naming,runtime}.test.ts`
- `packages/cmdkit-openapi/src/__snapshots__/generate.test.ts.snap`
- `packages/github-workflows/src/github-workflows-utils.test.ts`
- `packages/markdown-reader/src/core/{read-markdown,read-section,resolve}.test.ts`
- `packages/markdown-reader/src/mcp/{run,tools}.test.ts`
- `packages/superintendent/src/{cli,mcp,mcp-tools}.test.ts`
- `packages/terminal-pilot-mcp/src/{mcp-server,mcp-tools}.test.ts`
- `packages/terminal-pilot/src/cli.test.ts`
- `packages/terminal-pilot/src/commands/commands.test.ts`
- `src/cli/commands/misc-commands.test.ts`

### 4. Root-package subpath exports and published-files list

Current root publish tunnel in `package.json` that must be removed or rewritten:

- `exports["./cmdkit"]`
- `exports["./cmdkit/cli"]`
- `exports["./cmdkit/mcp"]`
- `exports["./cmdkit/sdk"]`
- `exports["./cmdkit-openapi"]`
- `bin["cmdkit-openapi-generate"]`
- `files` entries:
  - `packages/cmdkit/dist`
  - `packages/cmdkit-openapi/dist`
  - `packages/cmdkit-schema/dist`

Tests that lock the current root behavior:

- `src/index.test.ts`

Important compatibility note:

- root currently ships `packages/cmdkit-schema/dist` even without a root export because `scripts/bundle.mjs` rewrites shipped `cmdkit`/`cmdkit-openapi` `.d.ts` files to sibling relative paths under the root tarball
- once standalone publishing is canonical, those root relative-path rewrites should disappear with the tunnel

### 5. Build / bundle / pack scripts

Directly affected build plumbing:

- root `package.json`
  - `scripts.build`
  - `scripts.prepack`
  - `bin.cmdkit-openapi-generate`
  - `files`
- `scripts/bundle.mjs`
  - hard-coded `packages/cmdkit/*`
  - hard-coded `packages/cmdkit-openapi/*`
  - `.d.ts` rewrite map for `@poe-code/cmdkit`, `@poe-code/cmdkit-schema`
- `scripts/generate-bin-wrappers.mjs`
  - emits `dist/bin/cmdkit-openapi-generate.js`
  - imports `../../packages/cmdkit-openapi/dist/bin/generate.js`

Low-risk but touched-by-path build scripts:

- `packages/terminal-pilot/scripts/build.mjs`
- `packages/terminal-pilot-mcp/scripts/build.mjs`

Those two scripts derive aliases from workspace `package.json` names, so the functional risk is low once package names/directories move, but their comments and any emitted paths should still be aligned.

### 6. Generated code strings and snapshots that currently emit `@poe-code/cmdkit*`

Generator/source files that emit old names:

- `packages/cmdkit-openapi/src/generate.ts`
  - generated command imports
  - generated group imports
  - generated file banner
- `packages/cmdkit-openapi/src/bin/generate.ts`
  - help text `Usage: cmdkit-openapi-generate`
- `packages/cmdkit-openapi/src/auth/bearer-token-auth.ts`
  - default store dir `.cmdkit-openapi`
  - salt fragment `cmdkit-openapi`
- `packages/cmdkit-openapi/src/naming.ts`
  - error text mentioning `cmdkit-openapi`

Tests/snapshots that assert the old strings:

- `packages/cmdkit-openapi/src/__snapshots__/generate.test.ts.snap`
- `packages/cmdkit-openapi/src/generate.test.ts`
- `packages/cmdkit-openapi/src/generate-cli.test.ts`
- `packages/cmdkit-openapi/src/index.test.ts`

Docs/readmes that currently teach the old names:

- `packages/cmdkit/README.md`
- `packages/cmdkit-schema/README.md`
- `packages/cmdkit-openapi/README.md`

### 7. `package-lock.json` / `pnpm-lock.yaml` fallout

Both lockfiles will churn from both package-name changes and directory moves.

Current old-name/path hits:

- `package-lock.json`
  - `@poe-code/agent-kit` x6
  - `@poe-code/cmdkit` x19
  - `@poe-code/cmdkit-schema` x7
  - `@poe-code/cmdkit-openapi` x3
  - `packages/agent-kit` x2
  - `packages/cmdkit` x6
  - `packages/cmdkit-schema` x2
  - `packages/cmdkit-openapi` x2
- `pnpm-lock.yaml`
  - `@poe-code/agent-kit` x2
  - `@poe-code/cmdkit` x8
  - `@poe-code/cmdkit-schema` x4
  - `packages/agent-kit` x1
  - `packages/cmdkit` x4
  - `packages/cmdkit-schema` x2

Implementation rule:

- do not hand-edit locks beyond conflict resolution; regenerate after manifest/path renames are complete

### 8. Docs / plans / templates that assume `packages/agent-kit`

Direct path assumptions that must move with the workflow package directory rename:

- `packages/superintendent/src/templates/SKILL_superintendent.md`
- `packages/superintendent/src/document/parse.test.ts`
- `packages/superintendent/src/runtime/run-builder.test.ts`
- `packages/superintendent/src/runtime/run-inspector.test.ts`
- `packages/superintendent/src/runtime/run-owner-review.test.ts`
- `packages/superintendent/src/runtime/run-superintendent.test.ts`
- `docs/plans/archive/plan-agent-kit-single-doc-workflows.yaml`

Docs that also mention the old runtime package name:

- `docs/plans/archive/agent-kit-single-doc-workflows.md`
- `docs/plans/archive/plan-agent-kit-single-doc-workflows.yaml`

## Risky compatibility points to handle explicitly

1. **Root publish tunnel removal is a breaking change.**
   - Current `poe-code` consumers can import `poe-code/cmdkit` and use `cmdkit-openapi-generate` from the root package.
   - This migration intentionally moves ownership to standalone packages instead of keeping root compatibility forever.

2. **Directory renames and package-name renames are coupled.**
   - Leaving `packages/cmdkit*` directory names in place while publishing `agent-kit*` would keep the repo internally confusing.
   - Leaving `packages/agent-kit` in place while a different package becomes `agent-kit` would be actively misleading.

3. **Generated output changes must land atomically with snapshots.**
   - `packages/cmdkit-openapi` emits package names directly into generated source.
   - Partial renames will produce misleading snapshots and false-positive failures.

4. **User-facing generator/runtime strings are part of the migration surface.**
   - bin name, help text, auth-store directory, salt strings, and error copy must all move together.

5. **Root `.d.ts` rewrite logic is only valid while root tunneling exists.**
   - `scripts/bundle.mjs` currently rewrites type imports to sibling relative paths inside the root tarball.
   - That logic should not survive as hidden coupling once standalone packages are packed independently.

## Implementation order implied by this audit

1. Rename `packages/agent-kit` to `packages/agent-harness-tools` and move all runtime-helper imports/deps.
2. Rename `packages/cmdkit*` directories and package names to the standalone `agent-kit*` family.
3. Update generated-string emitters, tests, snapshots, and user-facing generator text in one pass.
4. Remove root `poe-code` publish tunneling for the command-stack packages.
5. Regenerate lockfiles and validate package tarballs as standalone installs.
