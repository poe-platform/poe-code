# QA Plan: GitHub Actions Local Testing with `act`

## Prerequisites

- [x] `act` installed (`brew install act`)
- [x] Docker running locally (colima)
- [x] `.actrc` configured at repo root
- [x] Event fixtures in `.github/act-events/`
- [x] `.github/act.secrets` gitignored

## How act works

1. `act` reads `.github/workflows/*.yml` and parses the YAML into a job graph
2. `.actrc` maps GitHub runner labels (e.g. `ubuntu-latest`) to local Docker images
3. For each job, act spins up a Docker container from the mapped image
4. Inside the container it replays every step: clones actions, runs shell commands, injects secrets/env vars
5. `-n` (dry-run) walks the entire job graph and resolves actions but skips actual execution — useful for validating structure, step ordering, and event routing without Docker overhead
6. `-e <file>` feeds a JSON event payload so act can evaluate `on:` triggers, `if:` conditions, and `github.event.*` expressions

## Test Cases

### TC-1: act detects all workflows

```bash
act -l
```

**What happens:** act scans `.github/workflows/`, parses every YAML file, and prints a table of Stage / Job ID / Job Name / Workflow Name / Workflow File / Events. This validates that all workflow files are syntactically valid enough for act to parse and that trigger events are correctly detected.

**Expected:** 10 workflow files, 12 jobs listed (release.yml has 2 jobs, pr-checks-pr.yml has 2 jobs).

### TC-2: Dry-run PR checks workflow

```bash
act -W .github/workflows/pr-checks.yml -n --detect-event
```

**What happens:** act resolves the `workflow_call` trigger, builds the job graph for the single `test` job, then walks each step in order: checkout → setup-node → npm ci → npm run build → npm test → npm run smoke. For each step it resolves the action ref (e.g. `actions/checkout@v4`) by cloning the action repo metadata, but does not execute anything. `--detect-event` lets act infer the trigger type from the workflow file.

**Expected:** All steps show `✅ Success` in dry-run. Job graph: checkout → setup-node → npm ci → build → test → smoke.

### TC-3: Dry-run PR checks (pull_request trigger) with event fixture

```bash
act pull_request -W .github/workflows/pr-checks-pr.yml -e .github/act-events/pull-request.json -n
```

**What happens:** act reads the `pull-request.json` fixture and populates `github.event.pull_request.*` context. It then evaluates `pr-checks-pr.yml` which has two jobs: `pr` (calls reusable `pr-checks.yml`) and `e2e`. The reusable workflow call is expanded inline. act walks both job graphs in parallel. The fixture's `action: "opened"` and `base.ref: "main"` match the workflow's `on.pull_request.branches: [main]` filter.

**Expected:** Two jobs run in dry-run: `pr/PR Checks/test` (build+test+smoke) and `e2e` (npm ci + e2e:verbose). Both succeed.

### TC-4: Dry-run issue-labeled workflow with event fixture

```bash
act issues -W .github/workflows/issue-resolution-agent.yml -e .github/act-events/issue-labeled.json -n
```

**What happens:** act loads `issue-labeled.json` which sets `action: "labeled"` and `label.name: "agent:claude"`. The workflow has `on.issues.types: [labeled]` and a job-level `if:` that checks the label starts with `agent:`. act evaluates that condition against the fixture data, determines the job should run, then walks all steps: checkout → setup-node → npm ci → build → install CLI globally → determine provider (reads label) → cache API key → install provider tooling → configure → test → run agent → generate PR metadata → create GitHub App token → create PR.

**Expected:** Job `Resolve Issue With Agent` dry-runs successfully. All 15+ steps resolve.

### TC-5: Dry-run issue-opened workflow with event fixture

```bash
act issues -W .github/workflows/poe-code-bot.yml -e .github/act-events/issue-opened.json -n
```

**What happens:** act loads `issue-opened.json` with `action: "opened"`. The workflow triggers on `issues: [assigned]` — note the mismatch: the fixture says "opened" but the workflow expects "assigned". act still dry-runs the job structure because `-n` doesn't fully evaluate trigger filters, it just walks the graph. Steps include: verify API token → checkout → setup-node → npm ci → build → install CLI → select agent service → cache token → install tooling → configure → run agent.

**Expected:** Job `Resolve Assigned Issue` dry-runs successfully. In a real run, the trigger mismatch would prevent execution on GitHub.

### TC-6: Secrets file is gitignored

```bash
echo "TEST_SECRET=test" > .github/act.secrets
git check-ignore .github/act.secrets
rm .github/act.secrets
```

**What happens:** Creates a temporary secrets file, asks git whether the path matches a `.gitignore` rule, then cleans up. `git check-ignore` exits 0 and prints the path if ignored, exits 1 if not.

**Expected:** Prints `.github/act.secrets` (exit 0). File is properly gitignored.

### TC-7: Live run of pr-checks (build + test)

```bash
act -W .github/workflows/pr-checks.yml -j test
```

**What happens:** act pulls the `catthehacker/ubuntu:act-latest` Docker image (mapped via `.actrc`), creates a container, and actually executes every step. It clones `actions/checkout@v4` and `actions/setup-node@v4` into the container, runs `npm ci`, `npm run build`, `npm test -- --force`, and `npm run smoke`. This is the closest local equivalent to what happens in GitHub CI. No secrets are needed for pr-checks.

**Expected:** All steps execute. Build and tests pass inside the container. This is the most meaningful validation — it catches issues like missing deps, Node version mismatches, or broken build scripts before pushing.

## Smoke Test (manual)

After all dry-runs pass, optionally run a full workflow with secrets:

```bash
act -W .github/workflows/pr-checks.yml --detect-event --secret-file .github/act.secrets
```

This runs the full pr-checks pipeline locally in Docker with secrets injected. Useful for validating CI changes before pushing.
