# QA Plan: GitHub Actions Local Testing with `act`

## Prerequisites

- [x] `act` installed (`brew install act`)
- [x] Docker running locally
- [x] `.actrc` configured at repo root
- [x] Event fixtures in `.github/act-events/`
- [x] `.github/act.secrets` gitignored

## Test Cases

### TC-1: act detects all workflows

```bash
act -l
```

**Expected:** Lists all 10 workflows with their jobs and trigger events.

### TC-2: Dry-run PR checks workflow

```bash
act -W .github/workflows/pr-checks.yml -n --detect-event
```

**Expected:** Dry-run completes, shows the job graph (build, test, smoke) without executing.

### TC-3: Dry-run PR checks (pull_request trigger) with event fixture

```bash
act pull_request -W .github/workflows/pr-checks-pr.yml -e .github/act-events/pull-request.json -n
```

**Expected:** Dry-run shows the workflow would trigger on the pull_request event.

### TC-4: Dry-run issue-labeled workflow with event fixture

```bash
act issues -W .github/workflows/issue-resolution-agent.yml -e .github/act-events/issue-labeled.json -n
```

**Expected:** Dry-run shows the workflow would trigger with the `agent:claude` label.

### TC-5: Dry-run issue-opened workflow with event fixture

```bash
act issues -W .github/workflows/poe-code-bot.yml -e .github/act-events/issue-opened.json -n
```

**Expected:** Dry-run shows the workflow would trigger on issue opened.

### TC-6: Secrets file is gitignored

```bash
echo "TEST_SECRET=test" > .github/act.secrets
git status .github/act.secrets
```

**Expected:** File does not appear in git status (is ignored). Clean up after test.

### TC-7: Live run of pr-checks (build + test only)

```bash
act -W .github/workflows/pr-checks.yml -j build
act -W .github/workflows/pr-checks.yml -j test
```

**Expected:** Jobs run inside Docker containers, npm install + build/test execute. May fail if secrets are missing — that's expected for agent workflows. pr-checks should work without secrets.

## Smoke Test (manual)

After all dry-runs pass, optionally run a real workflow:

```bash
act -W .github/workflows/pr-checks.yml --detect-event
```

This runs the full pr-checks pipeline locally in Docker. Useful for validating CI changes before pushing.
