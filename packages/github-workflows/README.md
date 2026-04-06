# @poe-code/github-workflows

Helpers for GitHub workflow prompt files.

## Quickstart

### 1. Add repository secrets

Go to your repository **Settings → Secrets and variables → Actions** and add:

| Secret | Description |
|--------|-------------|
| `POE_API_KEY` | Your Poe API key — required for all automations |
| `POE_CODE_AGENT_APP_ID` | GitHub App ID — used to generate a scoped token for each run |
| `POE_CODE_AGENT_PRIVATE_KEY` | GitHub App private key (PEM format) |

### 2. Install a workflow

```bash
poe-code github-workflows install <name>
# or shorthand
poe-code gh install <name>
```

This creates:
- `.github/workflows/poe-code-<name>.yml` — the GitHub Actions workflow
- `.poe-code/github-workflows/poe-code-<name>.md` — the prompt file (customize this)

### 3. Push to GitHub

The workflow triggers automatically on the configured event.

---

## Built-in Automations

| Name | Trigger | Description |
|------|---------|-------------|
| `github-issue-opened` | Issue opened | Reads the issue and implements the requested changes |
| `github-issue-comment-created` | Issue comment created | Acts on comments with a required prefix, restricted to allowed roles |
| `github-pull-request-opened` | PR opened | Reviews the pull request |
| `github-pull-request-synchronized` | PR updated | Re-reviews the PR after new commits are pushed |
| `fix-vulnerabilities` | Scheduled | Fetches open Dependabot alerts and fixes them one by one |
| `update-dependencies` | Manual / scheduled | Updates all dependencies to latest compatible versions |
| `update-documentation` | Manual / scheduled | Reviews code changes and updates documentation |

### List available automations

```bash
poe-code gh list
```

---

## Install Options

```bash
# Default — thin caller workflow that references upstream
poe-code gh install <name>

# Ejected — full workflow definition copied into your repo
poe-code gh install <name> --eject

# Uninstall
poe-code gh uninstall <name>
```

Use `--eject` when you need to modify the workflow YAML itself. The prompt file (`.poe-code/github-workflows/`) can be customized in both modes.

---

## Prompt Frontmatter Options

Each automation's prompt file supports the following frontmatter:

```yaml
---
label: "GitHub: Issue Handler"       # Display label (defaults to formatted name)

agent: "claude-code"                  # Agent to spawn (default: "codex")

allow:                                # GitHub author associations allowed to trigger
  - OWNER
  - MEMBER
  - COLLABORATOR

prefix: "poe-code"                    # Required comment prefix (comment workflows only)

source: "gh api repos/{owner}/{repo}/dependabot/alerts --jq '[.[]]'"
                                      # Command to fetch items; must output a JSON array.
                                      # The automation runs once per item.
                                      # Supports {owner} and {repo} placeholders.

mcp:                                  # MCP servers to make available to the agent
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

### Template variables

Variables available in the prompt body depend on the trigger:

| Variable | Available in |
|----------|-------------|
| `{{url}}` | All |
| `{{repo}}` | All |
| `{{issue.number}}`, `{{issue.title}}` | Issue workflows |
| `{{pr.number}}`, `{{pr.title}}`, `{{pr.author}}` | PR workflows |
| `{{comment.author}}`, `{{comment.body}}` | Comment workflows |
| `{{<field>}}` | Sourced automations — any field from the JSON item |

---

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `POE_API_KEY` | Yes | Poe API key — must be set as a repository secret |
| `POE_CODE_AGENT_APP_ID` | Yes | GitHub App ID — must be set as a repository secret |
| `POE_CODE_AGENT_PRIVATE_KEY` | Yes | GitHub App private key (PEM) — must be set as a repository secret |

`GITHUB_TOKEN` is generated at runtime from the GitHub App credentials using `actions/create-github-app-token`. Pass it to MCP servers via `${{ GITHUB_TOKEN }}` in the frontmatter `mcp.env` block when needed.

---

## Config

This package does not expose any config options.
