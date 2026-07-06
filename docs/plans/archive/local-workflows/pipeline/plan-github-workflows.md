---
kind: pipeline
version: 1
tasks:
  - id: frontmatter-parser
    title: Create package + frontmatter parser
    prompt: >
      Create the `packages/github-workflows` package (TDD).


      Files to create:
        - `packages/github-workflows/package.json`  — name `@poe-code/github-workflows`, depends on `@poe-code/cmdkit`
        - `packages/github-workflows/tsconfig.json` — extends root
        - `packages/github-workflows/src/frontmatter.ts` — parses YAML frontmatter from a markdown string;
          returns the frontmatter object and the prompt body separately
        - `packages/github-workflows/src/frontmatter.test.ts` — pure function tests, no mocking

      If a bug or missing feature is found in `@poe-code/cmdkit` during implementation,

      fix it directly in that package — do not work around it.
    status:
      implement: done
      refactor: done
      test: done
      commit: done
  - id: types-and-discovery
    title: Add AutomationDefinition type and discovery
    prompt: >
      Add types and two-layer discovery to `packages/github-workflows` (TDD).


      Files to create:
        - `packages/github-workflows/src/types.ts`:
          ```ts
          interface AutomationDefinition {
            name: string;       // derived from filename
            prompt: string;     // full markdown body (mustache template)
            source?: string;    // shell command returning JSON array
            agent?: string;     // override agent
            mcp?: McpSpawnConfig;
            allow?: string[];   // author_association values checked against COMMENT_AUTHOR_ASSOCIATION
            prefix?: string;    // required comment body prefix checked against COMMENT_BODY
          }
          ```
        - `packages/github-workflows/src/discover.ts`:
          - `discoverAutomations(builtInDir, projectDir?)` — reads both dirs, project-local overrides by name
          - `loadAutomation(name, dirs)` — finds first match by name
        - `packages/github-workflows/src/discover.test.ts` — mock `node:fs/promises` via `vi.mock`

      If a bug or missing feature is found in `@poe-code/cmdkit` during implementation,

      fix it directly in that package — do not work around it.
    status:
      implement: done
      refactor: done
      test: done
      commit: done
  - id: builtin-prompts
    title: Write 7 built-in automation prompt files
    prompt: |
      Create the built-in prompt markdown files under
      `packages/github-workflows/src/prompts/`:

        - `github-issue-opened.md`
        - `github-issue-comment-created.md` — include `allow: [OWNER, MEMBER, COLLABORATOR]`
          and `prefix: "poe-code"` in frontmatter
        - `github-pull-request-opened.md`
        - `github-pull-request-synchronized.md`
        - `fix-vulnerabilities.md` — include `source` and `mcp` frontmatter (see design doc
          `docs/plans/chore-plan.md`)
        - `update-dependencies.md`
        - `update-documentation.md`

      Also create `packages/github-workflows/src/prompts/prompts.test.ts` — validates that
      all built-in prompts parse without error and that every prompt with `allow` or `prefix`
      has valid values.
    status:
      implement: done
      refactor: done
      test: done
      commit: done
  - id: reusable-workflows
    title: Add 7 reusable workflows to this repo
    prompt: |
      Create the 7 reusable GitHub Actions workflow files at `.github/workflows/`:
        - `gh-github-issue-opened.yml`
        - `gh-github-issue-comment-created.yml`
        - `gh-github-pull-request-opened.yml`
        - `gh-github-pull-request-synchronized.yml`
        - `gh-fix-vulnerabilities.yml`
        - `gh-update-dependencies.yml`
        - `gh-update-documentation.yml`

      Each must use `on: workflow_call` with the correct inputs and `secrets: inherit`.
      `gh-github-issue-comment-created.yml` must include both guard steps in order:
        1. `npx poe-code github-workflows exec check-user-allow <name>`
        2. `npx poe-code github-workflows exec require-comment-prefix <name>`
        3. agent spawn step

      See `docs/plans/chore-plan.md` for the full workflow YAML examples.
      Run `npm run lint:workflows` before committing.
    status:
      implement: done
      refactor: done
      test: done
      commit: done
  - id: command-tree
    title: Implement cmdkit command tree
    prompt: |
      Implement the full command tree in `packages/github-workflows/src/commands.ts`.

      Commands:
        - `run` (default): resolve automation → run source if present → mustache-render per item
          → spawn agent with mcp servers
        - `list`: discoverAutomations → render table
        - `install --eject?`: default generates a thin caller workflow referencing
          `poe-code/poe-setup-scripts/.github/workflows/gh-<name>.yml@main` via `uses:`;
          `--eject` generates the full self-contained copy. Both copy the prompt to
          `.poe-code/github-workflows/<name>.md`.
        - `uninstall`: deletes `.github/workflows/gh-<name>.yml`, leaves prompt intact

      Exec subgroup (workflow step helpers, not user-facing):
        - `exec check-user-allow <name>`: loads automation, reads `allow` frontmatter,
          checks `COMMENT_AUTHOR_ASSOCIATION` env var, exits non-zero if not permitted
        - `exec require-comment-prefix <name>`: loads automation, reads `prefix` frontmatter,
          checks `COMMENT_BODY` env var starts with prefix (case-sensitive), exits non-zero if not

      Also create:
        - `packages/github-workflows/src/exec/check-user-allow.ts` + `.test.ts`
        - `packages/github-workflows/src/exec/require-comment-prefix.ts` + `.test.ts`
        - `packages/github-workflows/src/commands.test.ts`

      If a bug or missing feature is found in `@poe-code/cmdkit` during implementation,
      fix it directly in that package — do not work around it.
    status:
      implement: done
      refactor: done
      test: done
      commit: done
  - id: wire-cli-sdk
    title: Wire ghGroup into CLI and SDK
    prompt: |
      Mount `ghGroup` from `@poe-code/github-workflows` into the core:
        - `src/cli/program.ts` — mount via cmdkit CLI runner (no registerGhCommand wrapper)
        - `src/index.ts` — export `ghGroup` and `AutomationDefinition` from SDK

      Create `packages/github-workflows/src/index.ts` with public exports.
      Add `@poe-code/github-workflows` as a dependency in the core `package.json`.

      Run `npm run dev -- github-workflows --help` and take a screenshot to verify.
    status:
      implement: done
      refactor: done
      test: done
      commit: done
  - id: audit-workflows
    title: Audit existing workflows
    prompt: >
      Review all files in `.github/workflows/`. Categorize each as:

      - **keep**: release pipelines, CI checks (release*.yml, bump-version.yml, pr-checks*.yml,
      model-discovery.yml)

      - **replace**: legacy agent-driven workflows superseded by the new package:
        - comment-agent.yml → github-issue-comment-created
        - auto-resolve-issue.yml → github-issue-opened
        - pull-request-reviewer.yml → github-pull-request-opened

      Document findings as a comment at the top of this plan file. Do not modify files yet.
    status:
      implement: done
      refactor: done
      test: done
      commit: done
  - id: remove-legacy-workflows
    title: Delete legacy agent workflows
    prompt: |
      Delete the three legacy agent-driven workflows superseded by `@poe-code/github-workflows`:
        - `.github/workflows/comment-agent.yml`
        - `.github/workflows/auto-resolve-issue.yml`
        - `.github/workflows/pull-request-reviewer.yml`

      Run `npm run lint:workflows` to confirm no errors after deletion.
    status:
      implement: done
      refactor: done
      test: done
      commit: done
  - id: install-act
    title: Set up act for local workflow testing
    prompt: |
      Configure `act` (https://github.com/nektos/act) for local GitHub Actions testing.

      1. Create `.actrc` at repo root:
         ```
         --container-architecture linux/amd64
         --platform ubuntu-latest=catthehacker/ubuntu:act-latest
         ```
      2. Add `.secrets.act` to `.gitignore`.
      3. Document in `docs/TESTING.md`:
         - Install: `brew install act`
         - Docker must be running
         - Create `.secrets.act`: `POE_API_KEY=test` + `GITHUB_TOKEN=test`
         - Run: `act <event> -e <payload> --secret-file .secrets.act`
      4. Verify `act --list` shows all workflows without errors.
    status:
      implement: done
      refactor: done
      test: done
      commit: done
  - id: workflow-test-fixtures
    title: Write event payload fixtures for all edge cases
    prompt: |
      Create fixture JSON files under `.github/workflows/test/fixtures/`.
      Use fake data (`test-org/test-repo`). No real tokens.

      **allow check — one fixture per COMMENT_AUTHOR_ASSOCIATION value:**
        - `comment-owner.json`        — OWNER (allowed)
        - `comment-member.json`       — MEMBER (allowed)
        - `comment-collaborator.json` — COLLABORATOR (allowed)
        - `comment-contributor.json`  — CONTRIBUTOR (denied)
        - `comment-none.json`         — NONE (denied)

      **prefix check — COMMENT_BODY edge cases:**
        - `comment-prefixed.json`     — body starts with "poe-code ..." (allowed)
        - `comment-no-prefix.json`    — body with no prefix (denied)
        - `comment-prefix-only.json`  — body is exactly "poe-code" (allowed)
        - `comment-wrong-case.json`   — body starts with "Poe-Code ..." (denied, case-sensitive)
        - `comment-empty.json`        — empty body (denied)

      **other events:**
        - `issue-opened.json`
        - `pull-request-opened.json`
        - `pull-request-synchronized.json`
    status:
      implement: done
      refactor: done
      test: done
      commit: done
  - id: workflow-act-tests
    title: Write comprehensive act-based bats test suite
    prompt: |
      Write `.github/workflows/test/workflows.bats` using bats-core.
      Install: `npm install --save-dev bats` or document `brew install bats-core`.

      **Structural tests (--dry-run, no Docker, fast):**
        - All 7 `gh-*.yml` reusable workflows parse without error
        - `gh-github-issue-comment-created.yml` has `check-user-allow` then
          `require-comment-prefix` steps, in that order, before the agent step
        - All reusable workflows declare `on: workflow_call`
        - `pr-checks.yml` triggers on `pull_request`

      **Guard step exit-code tests (full run, needs Docker):**
        - `check-user-allow` exits 0 for OWNER, MEMBER, COLLABORATOR
        - `check-user-allow` exits non-zero for CONTRIBUTOR, NONE
        - `require-comment-prefix` exits 0 for body starting with "poe-code"
        - `require-comment-prefix` exits 0 for body exactly "poe-code"
        - `require-comment-prefix` exits non-zero for body with no prefix
        - `require-comment-prefix` exits non-zero for empty body
        - `require-comment-prefix` exits non-zero for wrong case ("Poe-Code")

      Add to `package.json`:
        `"test:workflows": "bats .github/workflows/test/workflows.bats"`
        `"test:workflows:fast": "bats --filter 'dry-run' .github/workflows/test/workflows.bats"`
    status:
      implement: done
      refactor: done
      test: done
      commit: done
  - id: regression-script
    title: Write workflow regression script
    prompt: |
      Create `scripts/test-workflows.sh` — single script for local and CI regression testing.

      Steps:
        1. `npm run lint:workflows` — fail fast on schema errors
        2. `act --list` — assert all workflows parseable
        3. `npm run test:workflows:fast` — dry-run structural bats tests (no Docker)
        4. If `ACT_FULL=1`: `npm run test:workflows` — full Docker-based bats suite
        5. Print PASSED/FAILED summary per section; exit non-zero if any fail

      Make executable (`chmod +x scripts/test-workflows.sh`).
      Add to `package.json`:
        `"test:workflows:all": "bash scripts/test-workflows.sh"`
        `"test:workflows:ci": "ACT_FULL=1 bash scripts/test-workflows.sh"`

      Document in `docs/TESTING.md`:
        - Local quick check: `npm run test:workflows:all`
        - Full CI-grade (needs Docker): `npm run test:workflows:ci`
    status:
      implement: done
      refactor: done
      test: done
      commit: done
  - id: screenshots-and-validate
    title: Screenshots, lint, and full regression run
    prompt: |
      1. Take screenshots for all CLI entry points:
           npm run screenshot-poe-code -- github-workflows --help
           npm run screenshot-poe-code -- github-workflows list
           npm run screenshot-poe-code -- github-workflows install --help
         Verify they look correct and are well-formatted.

      2. Run the full regression suite:
           npm run test:workflows:ci

      All sections must exit 0 before this task is complete.
      Fix any remaining issues found.
    status:
      implement: done
      refactor: done
      test: done
      commit: done
---

# github workflows

Archived local pipeline plan converted from YAML during docs cleanup.
