# @poe-code/github-workflows

Helpers for GitHub workflow prompt files.

## Repository Guardrail

This package also owns a repo-wide manifest invariant: `@modelcontextprotocol/sdk` is allowed under `packages/*/package.json` only in `devDependencies`.

Run the same assertion locally or in CI with:

```bash
npm run lint:mcp-sdk-deps --workspace @poe-code/github-workflows
```

See [GitHub persistent storage options](docs/github-persistent-storage.md) for workflow-safe cache, artifact, and repository-variable tradeoffs.

## Quickstart

### 1. Add repository secrets

Go to your repository **Settings → Secrets and variables → Actions** and add:

| Secret                       | Description                                                  |
| ---------------------------- | ------------------------------------------------------------ |
| `POE_API_KEY`                | Your Poe API key — required for all automations              |
| `POE_CODE_AGENT_APP_ID`      | GitHub App ID — used to generate a scoped token for each run |
| `POE_CODE_AGENT_PRIVATE_KEY` | GitHub App private key (PEM format)                          |

### 2. Install a workflow

```bash
poe-code github-workflows install <name>
# or shorthand
poe-code gh install <name>
```

This creates:

- `.github/workflows/poe-code-<name>.yml` — the GitHub Actions workflow
- `.github/workflows/variables.yaml` — optional shared prompt variable overrides
- `.github/workflows/README.md` — a local command reference for workflow helpers

This does not copy a local prompt file. The default install stays thin and references the built-in automation.

### 3. Push to GitHub

The workflow triggers automatically on the configured event.

---

## Built-in Automations

| Name                               | Trigger               | Description                                                                              |
| ---------------------------------- | --------------------- | ---------------------------------------------------------------------------------------- |
| `github-issue-opened`              | Issue labeled `agent` | Reads the issue, asks for missing details when needed, and implements actionable changes |
| `github-issue-comment-created`     | Issue comment created | Acts on prefixed issue comments, restricted to allowed roles                             |
| `github-pull-request-opened`       | PR opened             | Reviews the pull request                                                                 |
| `github-pull-request-synchronized` | PR updated            | Re-reviews the PR after new commits are pushed                                           |
| `fix-vulnerabilities`              | Scheduled             | Fetches open Dependabot alerts and fixes them one by one                                 |
| `update-dependencies`              | Manual / scheduled    | Updates all dependencies to latest compatible versions                                   |
| `update-documentation`             | Manual / scheduled    | Reviews code changes and updates documentation                                           |

The built-in GitHub issue, issue-comment, pull-request, pull-request-comment, and
pull-request-synchronized automations allow `OWNER`, `MEMBER`, `COLLABORATOR`,
and `CONTRIBUTOR` author associations by default.

The built-in issue-opened automation runs when the `agent` label is added to an
issue. Opening an issue without that label, or adding any other label, does not
spawn an agent. When the automation runs, it always leaves a visible response.
When the issue lacks enough detail for a code change, it asks for the missing
details and leaves the issue open instead of closing it.

### List available automations

```bash
poe-code gh list
```

## CLI Commands

| Command                             | Purpose                                                            |
| ----------------------------------- | ------------------------------------------------------------------ |
| `poe-code gh list`                  | List built-in and repo-local automations.                          |
| `poe-code gh install [name]`        | Install one automation, or all automations when `name` is omitted. |
| `poe-code gh uninstall <name>`      | Remove an installed automation workflow.                           |
| `poe-code gh run [name]`            | Run an automation locally or in GitHub Actions.                    |
| `poe-code gh prepare <name>`        | Install and configure the agent required by an automation.         |
| `poe-code gh prompt-preview <name>` | Preview the resolved prompt for an automation.                     |
| `poe-code gh variables`             | Show shared prompt variables and their source.                     |
| `poe-code gh require-* <name>`      | Validate comment author and prefix gates inside workflows.         |
| `poe-code gh trufflehog-pr-scan`    | Run TruffleHog PR scan helpers.                                    |

---

## Install Options

```bash
# Default — thin caller workflow that references upstream
poe-code gh install <name>

# Ejected — full workflow definition copied into your repo, plus a prompt file next to the workflow YAML
poe-code gh install <name> --eject

# Uninstall
poe-code gh uninstall <name>
```

Use `--eject` when you need full control over the workflow YAML itself.

With `--eject`, poe-code writes:

- `.github/workflows/poe-code-<name>.yml`
- `.github/workflows/poe-code-<name>.md`

For most customizations, **prefer `extends`** over `--eject` — see below.

---

## Customizing with `extends`

You can override specific automation fields (agent, allowed roles, prompt, etc.) without ejecting. Create a `.md` file alongside the workflow `.yml` with the same base name and set `extends: true` in the frontmatter. Fields you define override the built-in; everything else is inherited.

### Change the agent

`.github/workflows/poe-code-github-issue-opened.md`:

```yaml
---
extends: true
agent: claude-code
---
```

This keeps the built-in prompt, template variables, and all other settings — only the agent changes.

### Override multiple fields

`.github/workflows/poe-code-github-issue-opened.md`:

```yaml
---
extends: true
agent: claude-code
allow:
  - OWNER
  - MEMBER
---
```

### Add a custom prompt while inheriting config

`.github/workflows/poe-code-github-issue-opened.md`:

```yaml
---
extends: true
agent: claude-code
---
Read {{url}} and implement the requested changes.

Always add tests for new functionality.
```

When a prompt body is provided, it replaces the built-in prompt. When omitted, the built-in prompt is inherited.

### Prompt composition with `{{yield}}`

When using `extends`, you can use the `{{yield}}` token to compose prompts instead of fully replacing them. This lets you wrap the inherited prompt with your own instructions while still receiving upstream prompt updates.

**Wrap the built-in prompt with extra instructions:**

`.github/workflows/poe-code-github-issue-opened.md`:

```yaml
---
extends: true
---
Repository policy:
- keep changes small
- avoid unrelated refactors

{{yield}}
```

Here `{{yield}}` is replaced with the built-in prompt, so the final prompt becomes your policy rules followed by the inherited instructions.

**Built-in prompts can also use `{{yield}}`** to provide a stable wrapper where your custom content is inserted in the middle. If the base prompt contains `{{yield}}`, your prompt body fills that slot:

```
Base:   "Read {{url}}.\n\n{{yield}}\n\nAlways explain what changed."
Child:  "Focus on test coverage."
Result: "Read {{url}}.\n\nFocus on test coverage.\n\nAlways explain what changed."
```

Rules:

- Only one `{{yield}}` per prompt is allowed.
- If neither side uses `{{yield}}`, the child prompt replaces the base (existing behavior).
- If the child has no prompt body, `{{yield}}` resolves to an empty string.
- `{{yield}}` is resolved before template variables like `{{url}}`, so both can appear in the same prompt.

### `extends` vs `--eject`

|                                         | `extends`                       | `--eject` |
| --------------------------------------- | ------------------------------- | --------- |
| Receives upstream prompt updates        | Yes (unless you provide a body) | No        |
| Receives upstream workflow YAML updates | Yes                             | No        |
| Can change agent/allow/prefix/mcp       | Yes                             | Yes       |
| Can modify the workflow YAML            | No                              | Yes       |

---

## Prompt Frontmatter Options

Automation prompts support the following frontmatter (both in ejected files and `extends` overrides):

```yaml
---
label: "GitHub: Issue Handler" # Display label (defaults to formatted name)

agent: "claude-code" # Agent to spawn (default: "codex")

allow: # GitHub author associations allowed to trigger
  - OWNER
  - MEMBER
  - COLLABORATOR
  - CONTRIBUTOR

prefix: # Required comment prefix or aliases (comment workflows only)
  - "poe-code"
  - "poe-code-agent"
  - "@poe-code-agent"

source:
  "gh api repos/{owner}/{repo}/dependabot/alerts --jq '[.[]]'"
  # Command to fetch items; must output a JSON array.
  # The automation runs once per item.
  # Supports {owner} and {repo} placeholders.

mcp: # MCP servers to make available to the agent
  github:
    command: "npx"
    args:
      - "-y"
      - "@modelcontextprotocol/server-github"
    env:
      GITHUB_PERSONAL_ACCESS_TOKEN: "${{ GITHUB_TOKEN }}"
---
```

### `allow` — valid values

`OWNER`, `MEMBER`, `COLLABORATOR`, `CONTRIBUTOR`, `FIRST_TIME_CONTRIBUTOR`, `FIRST_TIMER`, `MANNEQUIN`, `NONE`

### `prefix`

`prefix` may be either:

- A single string such as `prefix: "poe-code"`
- A list of accepted aliases such as `poe-code`, `poe-code-agent`, and `@poe-code-agent`

### Template variables

Variables available in the prompt body depend on the trigger:

| Variable                                         | Available in                                       |
| ------------------------------------------------ | -------------------------------------------------- |
| `{{url}}`                                        | All                                                |
| `{{repo}}`                                       | All                                                |
| `{{issue.number}}`, `{{issue.title}}`            | Issue workflows                                    |
| `{{pr.number}}`, `{{pr.title}}`, `{{pr.author}}` | PR workflows                                       |
| `{{comment.author}}`, `{{comment.body}}`         | Issue-comment workflows                            |
| `{{<field>}}`                                    | Sourced automations — any field from the JSON item |

---

## Issue Comment Workflow Behavior

The built-in `github-issue-comment-created` workflow only runs for issue comments (not pull-request comments):

- On an issue, prefixed comments can make code changes and open or update a PR.
- On a pull request comment, the workflow is skipped.

The workflow also:

- Marks non-matching comments as skipped instead of failed.
- Adds an `eyes` reaction while work is in progress and removes it after the response is posted.
- Forces `OUTPUT_FORMAT=terminal` in GitHub Actions so the logs use the rich terminal renderer instead of JSON-style output.

---

## Run Failure Behavior

`poe-code gh run <name>` fails when any spawned agent run exits non-zero. This
applies to direct automations and sourced automations that fan out across JSON
items. The error reports the success count, the first failed exit code, and the
first failed run's stderr/stdout when present.

---

## Environment Variables

| Variable                     | Required | Description                                                       |
| ---------------------------- | -------- | ----------------------------------------------------------------- |
| `POE_API_KEY`                | Yes      | Poe API key — must be set as a repository secret                  |
| `POE_CODE_AGENT_APP_ID`      | Yes      | GitHub App ID — must be set as a repository secret                |
| `POE_CODE_AGENT_PRIVATE_KEY` | Yes      | GitHub App private key (PEM) — must be set as a repository secret |

`GITHUB_TOKEN` is generated at runtime from the GitHub App credentials using `actions/create-github-app-token`. Pass it to MCP servers via `${{ GITHUB_TOKEN }}` in the frontmatter `mcp.env` block when needed.

---

## Configuration Options

This package does not expose any config options.
