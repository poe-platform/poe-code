# poe-code GitHub App (Outline + Install Notes)

This document outlines a `poe-code` GitHub App that reacts to:

- An issue being assigned to the app/bot
- The app/bot being mentioned in an issue comment

## What you assign

After installing a GitHub App, the assignable account is usually the bot user:

- `<appname>[bot]` (for example: `poe-code[bot]`)

If `@poe-code` does not appear in the assignee picker, you likely want to assign to `poe-code[bot]` instead (or grant the `poe-code` user access if it’s a normal GitHub user).

## Install the app into a repo

Prerequisite: you have admin rights on the org/repo (or permission to install GitHub Apps).

1. Open the GitHub App page: `https://github.com/apps/<app-slug>`
2. Click `Install` / `Configure`
3. Choose the target org/user
4. Under **Repository access**, select `Only select repositories` and choose your repo
5. Click `Install`
6. Confirm the requested permissions and event subscriptions

## Assign an issue to the app/bot

### GitHub UI

Open the issue → right sidebar **Assignees** → select `poe-code[bot]` (or the app’s bot username).

### GitHub CLI

`gh issue edit <issue-number-or-url> --add-assignee poe-code[bot]`

## Events & triggers

### Issue assigned

- Webhook event: `issues`
- Action: `assigned`
- Typical guards:
  - Ignore if issue is closed
  - Ignore if assignee is not the app/bot (if you only want to react to bot assignment)

### Pull request review requested (code review assignment)

- Webhook event: `pull_request`
- Action: `review_requested`
- Trigger condition (choose what you support):
  - The bot user is the `requested_reviewer`
  - Or a team is the `requested_team`
- Typical guards:
  - Ignore if PR is closed or merged

### Mentioned in an issue comment

- Webhook event: `issue_comment`
- Action: `created`
- Trigger condition:
  - Comment body contains `@poe-code` (or the bot handle you choose)
- Optional command format:
  - `@poe-code <command> [args]`

## Behavior specification (fill in)

### On `issues.assigned`

Choose one or more actions:

- Add labels (example: `status:claimed`)
- Post a checklist comment for the assignee
- Add to a project / set a project field
- Create a status comment (or external job) with next steps

### On `pull_request.review_requested`

Choose one or more actions:

- Post an initial review checklist comment (or “review plan”)
- Apply labels (example: `status:needs-review`)
- Trigger an automated analysis workflow and post results back to the PR

### On `issue_comment.created` with mention

Choose one or more actions:

- Reply with supported commands/help
- Summarize context and propose a plan
- Apply labels / request missing info
- Start/track work and post progress updates

## Minimal permissions & subscriptions (suggested)

### Webhook subscriptions

- `issues`
- `issue_comment`
- `pull_request`

### GitHub App permissions (principle of least privilege)

- **Metadata**: read-only (required by most apps)
- **Issues**: read & write (commenting, labeling, assigning)
- **Pull requests**: read & write (list PRs, comment, label, respond to review requests)
- Optional (only if needed):
  - **Contents**: read & write

## Configuration (recommended)

Define repo-level configuration (example file name):

- `.github/poe-code.yml` (or JSON/TOML if preferred)

Configurable knobs:

- Bot handle / mention keyword(s)
- Enabled features per event (`issues.assigned`, `issue_comment.created`)
- Comment templates
- Label names / project fields
- Command allowlist

## Implementation options (pick one)

### Option A: GitHub App service (webhooks)

- You host a webhook receiver (API server)
- You verify the webhook signature
- You use GitHub App installation tokens to call the GitHub API

### Option B: GitHub App orchestrates, GitHub Actions executes (hybrid)

This keeps “logic/authorization” in the GitHub App, while the actual work runs inside GitHub Actions.

**How it works**

1. GitHub sends webhook to the App (`issues.assigned` / `issue_comment.created`)
2. The App decides what to do (parse mention/command, load config, permissions/guards)
3. The App triggers a workflow run in the same repo via the GitHub API:
   - `workflow_dispatch` (recommended when you have a specific workflow file)
   - or `repository_dispatch` (generic event that workflows can subscribe to)
4. The workflow performs the work (CI-style execution) and reports back:
   - comment on the issue, add labels, attach artifacts, etc.

**Workflow requirement**

Your workflow file must include one of:

- `on: workflow_dispatch` (and accept `inputs` you pass from the App)
- `on: repository_dispatch` (and react to a `event_type` you pass from the App)

**GitHub App permissions (add to the “Minimal permissions” above as needed)**

- To trigger workflows:
  - **Actions**: read & write
- If the workflow needs to read repo content:
  - **Contents**: read-only (or read & write if it will push changes)
- To let either the App or workflow comment/label:
  - **Issues**: read & write

**When to use this**

- You want GitHub-hosted execution (no servers/queues for the “work”)
- You still want a GitHub App identity + installation model and webhook-based triggers

### Option C: GitHub Actions only (not a GitHub App)

- Useful if you decide you don’t actually need a GitHub App
- Implemented via workflow YAML under `.github/workflows/`
