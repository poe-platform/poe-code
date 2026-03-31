# Simplify GitHub Actions

## Problem

13 workflow files with massive duplication:
- 3 agent workflows (auto-resolve-issue, comment-agent, model-discovery) copy-paste the same ~30 steps: auth, setup, agent config, branch resolution, PR metadata, PR creation
- 5 package release workflows are nearly identical: checkout → setup → build → auto-bump → publish
- The PR reviewer has a case statement for providers (violates CLAUDE.md: no if/case branching per provider)
- Inconsistent Node versions (20 vs 22), duplicated helper scripts with overlapping utility functions
- 9 workflow scripts in `scripts/workflows/` with duplicated `githubRequest`, `readEnv`, `splitRepository`, `parseNextLink`, `formatDate`, `formatBody`, `fail` functions across files

## Approach

### Phase 1: Consolidate package releases into a single reusable workflow

**Before:** 5 separate files (release-opencode-poe-auth.yml, release-poe-oauth.yml, release-tiny-mcp.yml, release-tiny-mcp-test.yml, release-tokenfill.yml)

**After:** 1 reusable `release-package.yml` with inputs:
```yaml
on:
  workflow_call:
    inputs:
      package:        # e.g. "tokenfill"
        required: true
        type: string
      package_dir:    # e.g. "packages/tokenfill"
        required: true
        type: string
      build_command:  # e.g. "bun run build --workspace tokenfill"
        required: true
        type: string
```

5 caller workflows become ~10 lines each (trigger + call reusable).

**Files changed:**
- New: `.github/workflows/release-package.yml`
- Simplify: all 5 release-*.yml to thin callers

### Phase 2: Extract agent setup into a reusable workflow

The common agent sequence is:
1. Checkout
2. Generate GitHub App token
3. Check eligible user
4. Setup Node + Bun
5. Install and build CLI
6. Configure agent (login, install, configure)
7. Configure git author

**After:** 1 reusable `agent-setup.yml` that outputs the app token and whether user is allowed.

The 3 agent workflows (auto-resolve-issue, comment-agent, model-discovery) call this, then only contain their unique logic.

**Files changed:**
- New: `.github/workflows/agent-setup.yml`
- Simplify: auto-resolve-issue.yml, comment-agent.yml, model-discovery.yml

### Phase 3: Extract branch resolution + PR creation into a reusable workflow

The "resolve issue PR branch → generate PR metadata → resolve PR metadata → create PR" block is identical across 3 workflows (~60 lines each).

**After:** 1 reusable `create-issue-pr.yml` with inputs:
```yaml
inputs:
  issue_number:
  issue_title:
  issue_body:
  app_token:    # from agent-setup
```

**Files changed:**
- New: `.github/workflows/create-issue-pr.yml`
- Simplify: auto-resolve-issue.yml, comment-agent.yml, model-discovery.yml

### Phase 4: Fix PR reviewer provider branching

The `case` statement in pull-request-reviewer.yml violates the "no if/case per provider" rule. The install + configure steps should be unified:

```yaml
- name: Install and configure reviewer
  run: |
    npx poe-code install "$SERVICE" --yes
    npx poe-code configure "$SERVICE" --yes
```

All providers already support `--yes` (auto-default) and `--api-key`. No case statement needed.

**Files changed:**
- Simplify: pull-request-reviewer.yml

### Phase 5: Standardize Node version

Pick Node 22 everywhere (it's already used in releases and model-discovery). pr-checks.yml still uses Node 20.

**Files changed:**
- pr-checks.yml: 20 → 22

### Phase 6: Deduplicate workflow scripts

`scripts/workflows/` has 6 .cjs files with duplicated utilities (githubRequest, readEnv, splitRepository, parseNextLink, formatDate, formatBody, fail). Extract shared utils into `scripts/workflows/lib/github.cjs`.

**Files changed:**
- New: `scripts/workflows/lib/github.cjs`
- Simplify: all .cjs scripts to import shared utilities

## Result

| Metric | Before | After |
|--------|--------|-------|
| Workflow files | 13 | 10 (3 new reusable, 5 release callers collapse to thin shells) |
| Total YAML lines (agent workflows) | ~450 | ~150 |
| Total YAML lines (release workflows) | ~200 | ~100 |
| Duplicated JS utility functions | ~6 copies | 1 shared module |

## Order of execution

1. Phase 1 (releases) — lowest risk, self-contained
2. Phase 4 (PR reviewer) — small, independent fix
3. Phase 5 (Node version) — trivial
4. Phase 6 (script dedup) — prerequisite for agent workflow changes
5. Phase 2 (agent setup) — requires testing with actual GH Actions
6. Phase 3 (PR creation) — final consolidation

## Risks

- Reusable workflows (`workflow_call`) cannot access `github.event` deeply — callers must pass needed fields as inputs
- The `peter-evans/create-pull-request` action needs to run in the same job as the checkout/agent work (it commits unstaged changes), so agent-setup can be a composite action OR a separate job only if we artifact the workspace
- Testing requires running actual GH Actions (no local unit tests per CLAUDE.md)
