# GitHub Actions: Auto-Resolve Issues via Agent

## Problem

Currently, agent workflows require explicit manual actions (labeling with `agent:*`, assigning the bot). This adds friction. We want:

1. Every issue opened by an eligible user → automatically resolved by the default coding agent
2. Every `issue_comment` by an eligible user on any open issue or PR conversation → triggers the agent to act on the new instruction

No labels, no mentions, no service selection. Always uses the default agent (`claude-code`).

## Eligible User

A single shared gate used by both workflows. Currently defined as:

> **Org member with write permission** on the repository.

Implemented as a reusable script `scripts/workflows/check-eligible-user.cjs`:

```js
// Input:  USERNAME env var
// Output: allowed=true|false to $GITHUB_OUTPUT
//
// Checks:
// 1. User is an org member (orgs.checkMembershipForUser)
// 2. User has write or admin permission (repos.getCollaboratorPermissionLevel)
// Both must pass.
```

This is the **only** authorization check. Both workflows call it the same way — the only difference is where the username comes from (`issue.user.login` vs `comment.user.login`).

Important: this gate cannot rely on the default `secrets.GITHUB_TOKEN` for private-org membership checks. The membership endpoint needs org `Members` read permission, which `GITHUB_TOKEN` does not expose via workflow permissions. The gate must use a GitHub App token (or PAT) with org-members read access.

If the eligibility criteria changes later (e.g. add a team allowlist, or drop the org check), it's a single-file change.

## Goals

1. Issue creation by eligible user auto-triggers agent resolution
2. Any `issue_comment` by an eligible user on any open issue or PR conversation re-triggers the agent with full conversation context
3. Hardcoded default agent — no provider selection logic
4. Agent posts output as a comment; creates a PR for issues when code changes exist
5. On PR-comment triggers, agent targets the PR head branch (same-repo PRs)

## Non-Goals

- Service/provider selection (always `claude-code`)
- Mention-based or label-based triggering
- PR review comments (inline code review)

## Design

### Two workflows, one agent, one gate

| Workflow | Trigger | Gate |
|----------|---------|------|
| `auto-resolve-issue.yml` | `issues.opened` | `check-eligible-user.cjs` on issue author |
| `comment-agent.yml` | `issue_comment.created` (issues + PR conversations) | `check-eligible-user.cjs` on comment author + not a bot + issue is open |

Both spawn `claude-code` with the full conversation as context.

Note: the comment workflow gates on the **commenter**, not the issue/PR author. An eligible user commenting on any open issue/PR conversation (regardless of who created it) triggers the agent. This is intentional — it lets maintainers steer agent work on issues opened by external contributors and on active PR threads.

### Shared Script: `scripts/workflows/check-eligible-user.cjs`

```js
#!/usr/bin/env node
const { appendFileSync } = require("node:fs");

async function main() {
  const username = requireEnv("USERNAME");
  const repo = requireEnv("GITHUB_REPOSITORY");
  const token = requireEnv("GITHUB_TOKEN");
  const outputPath = requireEnv("GITHUB_OUTPUT");

  const [owner, repoName] = repo.split("/");

  // Check 1: org membership
  const isMember = await checkOrgMembership(owner, username, token);
  if (!isMember) {
    appendFileSync(outputPath, "allowed=false\n");
    return;
  }

  // Check 2: write or admin permission
  const hasWrite = await checkWritePermission(owner, repoName, username, token);
  appendFileSync(outputPath, `allowed=${hasWrite ? "true" : "false"}\n`);
}
```

Both workflows call it identically (after creating a GitHub App token with org-members read permission):

```yaml
- name: Check eligible user
  id: auth
  env:
    USERNAME: ${{ <source>.user.login }}
    GITHUB_TOKEN: ${{ steps.app_token.outputs.token }}
    GITHUB_REPOSITORY: ${{ github.repository }}
  run: node scripts/workflows/check-eligible-user.cjs
```

### Workflow 1: `auto-resolve-issue.yml`

Triggers on every new issue. Checks eligibility of the issue author, then spawns the agent.

```yaml
name: Auto Resolve Issue
on:
  issues:
    types: [opened]

concurrency:
  group: agent-issue-${{ github.event.issue.number }}
  cancel-in-progress: true

jobs:
  resolve:
    name: Auto Resolve
    runs-on: ubuntu-latest
    permissions:
      contents: write
      issues: write
      pull-requests: write
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Generate GitHub App token
        id: app_token
        uses: actions/create-github-app-token@v1
        with:
          app-id: ${{ secrets.POE_CODE_AGENT_APP_ID }}
          private-key: ${{ secrets.POE_CODE_AGENT_PRIVATE_KEY }}
          owner: ${{ github.repository_owner }}

      - name: Check eligible user
        id: auth
        env:
          USERNAME: ${{ github.event.issue.user.login }}
          GITHUB_TOKEN: ${{ steps.app_token.outputs.token }}
          GITHUB_REPOSITORY: ${{ github.repository }}
        run: node scripts/workflows/check-eligible-user.cjs

      - name: Setup Node.js
        if: steps.auth.outputs.allowed == 'true'
        uses: actions/setup-node@v4
        with:
          node-version: "20"
          cache: npm

      - name: Install and build
        if: steps.auth.outputs.allowed == 'true'
        run: npm ci && npm run build && npm install -g .

      - name: Configure agent
        if: steps.auth.outputs.allowed == 'true'
        env:
          POE_API_KEY: ${{ secrets.POE_API_KEY }}
        run: |
          poe-code login --api-key "${POE_API_KEY}"
          poe-code install claude-code --yes
          poe-code configure claude-code --yes

      - name: Configure git author
        if: steps.auth.outputs.allowed == 'true'
        run: |
          git config user.name "Poe Code Agent"
          git config user.email "developers@poe.com"

      - name: Build prompt and spawn agent
        if: steps.auth.outputs.allowed == 'true'
        id: agent
        env:
          ISSUE_NUMBER: ${{ github.event.issue.number }}
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          GITHUB_REPOSITORY: ${{ github.repository }}
        run: |
          PROMPT=$(node scripts/workflows/build-issue-prompt.cjs)
          OUTPUT_FILE="$RUNNER_TEMP/agent-output-issue-${{ github.event.issue.number }}.txt"
          poe-code spawn claude-code "$PROMPT" | tee "$OUTPUT_FILE"
          echo "output_file=$OUTPUT_FILE" >> "$GITHUB_OUTPUT"

      - name: Post agent response
        if: steps.auth.outputs.allowed == 'true'
        uses: actions/github-script@v7
        env:
          AGENT_OUTPUT_FILE: ${{ steps.agent.outputs.output_file }}
        with:
          script: |
            const { readFileSync } = require('node:fs');
            const path = process.env.AGENT_OUTPUT_FILE;
            const output = path ? readFileSync(path, 'utf8').trim() : '';
            const body = output || '_No output from agent._';
            await github.rest.issues.createComment({
              owner: context.repo.owner,
              repo: context.repo.repo,
              issue_number: context.payload.issue.number,
              body: `**Agent response:**\n\n${body}`
            });

      - name: Create pull request if changes exist
        if: steps.auth.outputs.allowed == 'true'
        uses: peter-evans/create-pull-request@v6
        with:
          token: ${{ steps.app_token.outputs.token }}
          branch: agent/auto-resolve/issue-${{ github.event.issue.number }}
          title: "fix: resolve issue #${{ github.event.issue.number }}"
          body: |
            Resolves #${{ github.event.issue.number }}

            Auto-resolved by poe-code agent.
          commit-message: "fix: resolve issue #${{ github.event.issue.number }}"
          delete-branch: true
```

Note: `peter-evans/create-pull-request` is a no-op when there are no changes, so no conditional logic is needed.

### Workflow 2: `comment-agent.yml`

Triggers on every new `issue_comment` event (issue threads and PR conversation threads). Checks eligibility of the comment author, then spawns the agent with the full conversation + the triggering comment highlighted.

Branch targeting for comment triggers:

- Issue comment: create/update a dedicated agent branch + PR via `create-pull-request`
- PR conversation comment (same-repo PR): checkout the PR head branch and push commits directly to that branch
- PR conversation comment (fork PR): fallback to creating an agent branch in the base repository

```yaml
name: Comment Agent
on:
  issue_comment:
    types: [created]

concurrency:
  group: agent-issue-${{ github.event.issue.number }}
  cancel-in-progress: true

jobs:
  agent:
    name: Handle Comment
    if: >-
      github.event.issue.state == 'open' &&
      github.event.comment.user.type != 'Bot'
    runs-on: ubuntu-latest
    permissions:
      contents: write
      issues: write
      pull-requests: write
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Generate GitHub App token
        id: app_token
        uses: actions/create-github-app-token@v1
        with:
          app-id: ${{ secrets.POE_CODE_AGENT_APP_ID }}
          private-key: ${{ secrets.POE_CODE_AGENT_PRIVATE_KEY }}
          owner: ${{ github.repository_owner }}

      - name: Check eligible user
        id: auth
        env:
          USERNAME: ${{ github.event.comment.user.login }}
          GITHUB_TOKEN: ${{ steps.app_token.outputs.token }}
          GITHUB_REPOSITORY: ${{ github.repository }}
        run: node scripts/workflows/check-eligible-user.cjs

      - name: Resolve comment target
        if: steps.auth.outputs.allowed == 'true'
        id: target
        uses: actions/github-script@v7
        with:
          script: |
            const isPrConversation = Boolean(context.payload.issue.pull_request);
            if (!isPrConversation) {
              core.setOutput('mode', 'issue');
              core.setOutput('same_repo', 'false');
              return;
            }
            const pr = await github.rest.pulls.get({
              owner: context.repo.owner,
              repo: context.repo.repo,
              pull_number: context.payload.issue.number
            });
            const headRepo = pr.data.head?.repo?.full_name ?? '';
            const currentRepo = `${context.repo.owner}/${context.repo.repo}`;
            core.setOutput('mode', 'pr');
            core.setOutput('head_ref', pr.data.head.ref);
            core.setOutput('same_repo', String(headRepo === currentRepo));

      - name: Checkout PR head branch (same repo)
        if: steps.auth.outputs.allowed == 'true' && steps.target.outputs.mode == 'pr' && steps.target.outputs.same_repo == 'true'
        uses: actions/checkout@v4
        with:
          ref: ${{ steps.target.outputs.head_ref }}

      - name: React with eyes
        if: steps.auth.outputs.allowed == 'true'
        uses: actions/github-script@v7
        with:
          script: |
            await github.rest.reactions.createForIssueComment({
              owner: context.repo.owner,
              repo: context.repo.repo,
              comment_id: context.payload.comment.id,
              content: 'eyes'
            });

      - name: Setup Node.js
        if: steps.auth.outputs.allowed == 'true'
        uses: actions/setup-node@v4
        with:
          node-version: "20"
          cache: npm

      - name: Install and build
        if: steps.auth.outputs.allowed == 'true'
        run: npm ci && npm run build && npm install -g .

      - name: Configure agent
        if: steps.auth.outputs.allowed == 'true'
        env:
          POE_API_KEY: ${{ secrets.POE_API_KEY }}
        run: |
          poe-code login --api-key "${POE_API_KEY}"
          poe-code install claude-code --yes
          poe-code configure claude-code --yes

      - name: Configure git author
        if: steps.auth.outputs.allowed == 'true'
        run: |
          git config user.name "Poe Code Agent"
          git config user.email "developers@poe.com"

      - name: Build prompt and spawn agent
        if: steps.auth.outputs.allowed == 'true'
        id: agent
        env:
          ISSUE_NUMBER: ${{ github.event.issue.number }}
          COMMENT_BODY: ${{ github.event.comment.body }}
          COMMENT_AUTHOR: ${{ github.event.comment.user.login }}
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          GITHUB_REPOSITORY: ${{ github.repository }}
        run: |
          PROMPT=$(node scripts/workflows/build-comment-prompt.cjs)
          OUTPUT_FILE="$RUNNER_TEMP/agent-output-comment-${{ github.event.issue.number }}.txt"
          poe-code spawn claude-code "$PROMPT" | tee "$OUTPUT_FILE"
          echo "output_file=$OUTPUT_FILE" >> "$GITHUB_OUTPUT"

      - name: Post agent response
        if: steps.auth.outputs.allowed == 'true'
        uses: actions/github-script@v7
        env:
          AGENT_OUTPUT_FILE: ${{ steps.agent.outputs.output_file }}
        with:
          script: |
            const { readFileSync } = require('node:fs');
            const path = process.env.AGENT_OUTPUT_FILE;
            const output = path ? readFileSync(path, 'utf8').trim() : '';
            const body = output || '_No output from agent._';
            await github.rest.issues.createComment({
              owner: context.repo.owner,
              repo: context.repo.repo,
              issue_number: context.payload.issue.number,
              body: `**Agent response:**\n\n${body}`
            });

      - name: Create pull request if changes exist
        if: steps.auth.outputs.allowed == 'true' && (steps.target.outputs.mode != 'pr' || steps.target.outputs.same_repo != 'true')
        uses: peter-evans/create-pull-request@v6
        with:
          token: ${{ steps.app_token.outputs.token }}
          branch: agent/comment/issue-${{ github.event.issue.number }}
          title: "fix: resolve issue #${{ github.event.issue.number }}"
          body: |
            Resolves #${{ github.event.issue.number }}

            Triggered by comment from @${{ github.event.comment.user.login }}.
          commit-message: "fix: resolve issue #${{ github.event.issue.number }}"
          delete-branch: true

      - name: Push commits to existing PR branch
        if: steps.auth.outputs.allowed == 'true' && steps.target.outputs.mode == 'pr' && steps.target.outputs.same_repo == 'true'
        run: |
          git push origin "HEAD:${{ steps.target.outputs.head_ref }}"

      - name: React with thumbs up on success
        if: success() && steps.auth.outputs.allowed == 'true'
        uses: actions/github-script@v7
        with:
          script: |
            await github.rest.reactions.createForIssueComment({
              owner: context.repo.owner,
              repo: context.repo.repo,
              comment_id: context.payload.comment.id,
              content: '+1'
            });

      - name: React with thumbs down on failure
        if: failure()
        uses: actions/github-script@v7
        with:
          script: |
            await github.rest.reactions.createForIssueComment({
              owner: context.repo.owner,
              repo: context.repo.repo,
              comment_id: context.payload.comment.id,
              content: '-1'
            });
```

### New Script: `scripts/workflows/build-comment-prompt.cjs`

Same as `build-issue-prompt.cjs` but appends the triggering comment as a highlighted instruction:

```
You are working on GitHub issue #42: Fix auth bug.
Implement the required changes and commit them.

Conversation:
@alice (2026-02-27T10:00:00Z):
The login flow breaks when...

@bob (2026-02-27T11:00:00Z):
I can reproduce this on...

---
Latest instruction (from @bob):
fix the flaky test in auth.spec.ts
---

Act on the latest instruction above. If code changes are needed, implement them.
If the instruction is a question, answer it based on the codebase.
```

Input env vars: `ISSUE_NUMBER`, `COMMENT_BODY`, `COMMENT_AUTHOR`, `GITHUB_TOKEN`, `GITHUB_REPOSITORY`

### Bot Loop Prevention

Both workflows share the same concurrency group (`agent-issue-{number}`), so they can't run simultaneously on the same issue/PR thread. The comment workflow also filters out bot comments via `github.event.comment.user.type != 'Bot'`, preventing infinite loops where the agent's own response comment re-triggers itself.

## File Changes

| File | Change |
|------|--------|
| `.github/workflows/auto-resolve-issue.yml` | New workflow — auto-resolve on issue creation |
| `.github/workflows/comment-agent.yml` | New workflow — re-trigger on eligible user comments |
| `scripts/workflows/check-eligible-user.cjs` | New script — shared eligibility gate (org member + write permission) |
| `scripts/workflows/build-comment-prompt.cjs` | New script — prompt with conversation + highlighted triggering comment |

## Concurrency

Both workflows share the same concurrency group pattern:

```yaml
concurrency:
  group: agent-issue-${{ github.event.issue.number }}
  cancel-in-progress: true
```

This ensures:
- Only one agent run per issue/PR thread at a time across both workflows
- A new comment cancels any in-progress agent run on the same issue/PR thread

## Security Considerations

- **Single eligibility gate** — org membership + write permission, defined once in `check-eligible-user.cjs`
- **Correct token for org check** — eligibility gate uses GitHub App token with org-members read permission (not default `GITHUB_TOKEN`)
- **Bot filter** — `user.type != 'Bot'` prevents feedback loops
- **Shared concurrency** — prevents spam-triggering and runaway costs
- **Secret exposure** — same model as existing workflows

## Relationship to Existing Workflows

This plan **replaces** the current triggering model:

| Current | New |
|---------|-----|
| `poe-code-bot.yml` (issue assigned) | `auto-resolve-issue.yml` (issue opened) |
| `issue-resolution-agent.yml` (label added) | `auto-resolve-issue.yml` (issue opened) + `comment-agent.yml` (follow-up) |

The old workflows should be removed after rollout to avoid duplicate agent runs.

## QA: Local Testing with `act`

New event fixtures and test cases to add alongside the existing `act` QA infrastructure.

### New Event Fixtures

#### `.github/act-events/issue-opened-eligible.json`

```json
{
  "action": "opened",
  "issue": {
    "number": 99,
    "title": "Auto-resolve test issue",
    "body": "This issue should be auto-resolved by the agent.",
    "state": "open",
    "user": {
      "login": "eligible-org-member",
      "type": "User"
    },
    "labels": [],
    "assignees": []
  },
  "repository": {
    "full_name": "poe-platform/poe-code",
    "name": "poe-code",
    "owner": { "login": "poe-platform" }
  }
}
```

#### `.github/act-events/issue-opened-external.json`

Same as above but with `"login": "external-user"` — should be rejected by the eligibility gate.

#### `.github/act-events/comment-eligible.json`

```json
{
  "action": "created",
  "comment": {
    "id": 1001,
    "body": "Please fix the flaky test in auth.spec.ts",
    "user": {
      "login": "eligible-org-member",
      "type": "User"
    }
  },
  "issue": {
    "number": 42,
    "title": "Auth test is flaky",
    "body": "The auth test fails intermittently.",
    "state": "open",
    "user": {
      "login": "external-contributor",
      "type": "User"
    },
    "labels": [],
    "assignees": []
  },
  "repository": {
    "full_name": "poe-platform/poe-code",
    "name": "poe-code",
    "owner": { "login": "poe-platform" }
  }
}
```

#### `.github/act-events/comment-bot.json`

Same as above but with `"type": "Bot"` on the comment user — should be skipped by the job-level `if`.

#### `.github/act-events/comment-closed-issue.json`

Same as `comment-eligible.json` but with `"state": "closed"` — should be skipped by the job-level `if`.

#### `.github/act-events/comment-pr-same-repo.json`

Same as `comment-eligible.json`, but `issue` includes a `pull_request` object to represent a PR conversation comment on an open same-repo PR.

#### `.github/act-events/comment-pr-fork.json`

Same as `comment-pr-same-repo.json`, but intended to exercise the fork fallback path (agent creates a branch in base repo instead of pushing to fork head branch).

### Test Cases

#### TC-A1: Dry-run auto-resolve — eligible user

```bash
act issues -W .github/workflows/auto-resolve-issue.yml -e .github/act-events/issue-opened-eligible.json -n
```

- Loads fixture with `action: "opened"`, eligible user
- Dry-run validates workflow graph and expression parsing
- **Expected:** Job is selected and steps are listed without expression errors

#### TC-A2: Dry-run auto-resolve — external user

```bash
act issues -W .github/workflows/auto-resolve-issue.yml -e .github/act-events/issue-opened-external.json -n
```

- Loads fixture with external user
- Dry-run validates that downstream steps are guarded by `if: steps.auth.outputs.allowed == 'true'`
- **Expected:** No workflow-graph or expression failures in dry-run output

#### TC-A3: Dry-run comment agent — eligible user on open issue

```bash
act issue_comment -W .github/workflows/comment-agent.yml -e .github/act-events/comment-eligible.json -n
```

- Loads fixture with eligible commenter, open issue
- Job-level `if` passes (open + not bot)
- Dry-run validates workflow graph and expression parsing
- **Expected:** Job is selected and steps are listed without expression errors

#### TC-A4: Dry-run comment agent — bot comment skipped

```bash
act issue_comment -W .github/workflows/comment-agent.yml -e .github/act-events/comment-bot.json -n
```

- Loads fixture with `user.type: "Bot"`
- Job-level `if` fails → entire job skipped
- **Expected:** Job `Handle Comment` skipped

#### TC-A5: Dry-run comment agent — closed issue skipped

```bash
act issue_comment -W .github/workflows/comment-agent.yml -e .github/act-events/comment-closed-issue.json -n
```

- Loads fixture with `issue.state: "closed"`
- Job-level `if` fails → entire job skipped
- **Expected:** Job `Handle Comment` skipped

#### TC-A6: check-eligible-user.cjs unit validation

```bash
USERNAME='test-user' \
GITHUB_REPOSITORY='poe-platform/poe-code' \
GITHUB_TOKEN='fake' \
GITHUB_OUTPUT='/dev/stdout' \
node scripts/workflows/check-eligible-user.cjs
```

- Verifies the script runs without syntax errors and produces `allowed=true|false` output
- Will fail on the API call (fake token), but validates script loads and parses env vars
- **Expected:** Script executes, fails with GitHub API auth error (not a parse/syntax error)

#### TC-A7: act detects new workflows

```bash
act -l
```

- Should now list `auto-resolve-issue.yml` and `comment-agent.yml` in the job table
- **Expected:** Previous count + 2 new jobs

#### TC-A8: Dry-run comment agent — PR conversation comment

```bash
act issue_comment -W .github/workflows/comment-agent.yml -e .github/act-events/comment-pr-same-repo.json -n
```

- Validates PR-conversation path is accepted by job-level `if`
- Confirms workflow includes `Resolve comment target` and PR-branch logic steps
- **Expected:** Job is selected and step graph resolves in dry-run

## Open Questions

1. **Fork PR behavior**: Keep fallback-to-base-repo branch creation, or hard-skip fork PR comments with an explanatory agent comment?
2. **PR diff context**: For PR conversation comments, should the prompt include full PR diff in addition to issue/comment thread?
3. **Cost guardrails**: Should there be a daily/hourly limit on agent runs per repo?
