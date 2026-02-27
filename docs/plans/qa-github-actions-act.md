# QA Plan: GitHub Actions Local Testing with `act`

## Prerequisites

- [x] `act` installed (`brew install act`)
- [x] Docker running locally (colima)
- [x] `.actrc` configured at repo root
- [x] Event fixtures in `.github/act-events/`
- [x] `.github/act.secrets` gitignored

## How act works

1. Reads `.github/workflows/*.yml` → parses into job graph
2. `.actrc` maps runner labels (`ubuntu-latest`) → local Docker images
3. Spins up Docker container per job, replays steps inside
4. `-n` dry-runs the graph without execution
5. `-e <file>` injects event payload for trigger/condition evaluation

## Test Cases

### TC-1: act detects all workflows

```bash
act -l
```

- Scans `.github/workflows/`, parses YAML, prints job table
- Validates all workflow files are parseable
- **Expected:** Workflow list includes `model-discovery.yml` and all workflows parse successfully

### TC-2: Dry-run PR checks workflow

```bash
act -W .github/workflows/pr-checks.yml -n --detect-event
```

- Resolves `workflow_call` trigger for `test` job
- Walks steps: checkout → setup-node → npm ci → build → test → smoke
- Resolves action refs without executing
- **Expected:** All steps `✅ Success`

### TC-3: Dry-run PR checks with event fixture

```bash
act pull_request -W .github/workflows/pr-checks-pr.yml -e .github/act-events/pull-request.json -n
```

- Populates `github.event.pull_request.*` from fixture
- Expands reusable workflow call inline
- Walks two jobs in parallel: `pr` (build+test+smoke) and `e2e`
- **Expected:** Both jobs succeed in dry-run

### TC-4: Dry-run issue-labeled workflow

```bash
act issues -W .github/workflows/issue-resolution-agent.yml -e .github/act-events/issue-labeled.json -n
```

- Loads fixture with `action: "labeled"`, `label.name: "agent:claude"`
- Evaluates job-level `if:` condition (label starts with `agent:`)
- Walks 15+ steps: setup → build → determine provider → run agent → create PR
- **Expected:** Job `Resolve Issue With Agent` dry-runs successfully

### TC-5: Dry-run issue-opened workflow

```bash
act issues -W .github/workflows/poe-code-bot.yml -e .github/act-events/issue-opened.json -n
```

- Loads fixture with `action: "opened"` (workflow expects `assigned` — mismatch)
- Dry-run still walks the graph (`-n` skips trigger filter evaluation)
- Walks steps: verify token → setup → build → select service → run agent
- **Expected:** Job dry-runs successfully. Real run would not trigger on GitHub.

### TC-6: Secrets file is gitignored

```bash
echo "TEST_SECRET=test" > .github/act.secrets
git check-ignore .github/act.secrets
rm .github/act.secrets
```

- Creates temp secrets file, checks gitignore, cleans up
- **Expected:** `git check-ignore` exits 0

### TC-7: Live run of pr-checks

```bash
act -W .github/workflows/pr-checks.yml -j test
```

- Pulls Docker image, creates container, executes all steps for real
- Runs npm ci → build → test → smoke inside container
- No secrets needed for pr-checks
- **Expected:** Build and tests pass. Catches dep/Node/script issues before pushing.

### TC-8: Dry-run model-discovery workflow

```bash
act schedule -W .github/workflows/model-discovery.yml -e .github/act-events/model-discovery.json -n
```

- Loads fixture with `schedule` trigger
- Walks jobs: `discover` and conditional `resolve`
- **Expected:** All steps dry-run successfully

### TC-9: Dry-run model-discovery with workflow_dispatch

```bash
act workflow_dispatch -W .github/workflows/model-discovery.yml -n
```

- Validates manual trigger path
- **Expected:** `discover` dry-runs; `resolve` behavior follows fixture outputs

## Smoke Test (manual)

```bash
act -W .github/workflows/pr-checks.yml --detect-event --secret-file .github/act.secrets
```

Full pr-checks pipeline locally in Docker with secrets. Validates CI changes before pushing.
