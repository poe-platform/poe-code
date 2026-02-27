# Automated Model Discovery via GitHub Actions

## Problem

Models in `poe-code` are hardcoded in `src/cli/constants.ts` (per-agent model lists) and in provider files. When Poe adds, removes, or renames models, nobody knows until someone manually checks.

We want automated detection that:

1. Records each model state event (`added`, `removed`, `renamed`) as its own issue.
2. Determines whether code changes are needed with specific source evidence.
3. Runs the resolver in the same workflow for actionable issues (no cross-workflow trigger dependency).

## Data Source

Primary source: `https://models.poecdn.net/changelog.json`

- Structured JSON for `added`, `removed`, and `price_changes`.

Rename source (current): `https://models.poecdn.net/test_changelog.json`

- Structured JSON includes `renamed` as:
  - `{ "from": "<old-id>", "to": "<new-id>" }`

The script should ingest both:

1. `changelog.json` for `added` and `removed`.
2. `test_changelog.json` for `renamed`.

`changelog.json` entry example:

```json
{
  "date": "2026-02-26T23:59:00+00:00",
  "added": ["kling-o3", "kling-v3", "nano-banana-2"],
  "removed": ["old-model-x"],
  "price_changes": [{ "id": "nano-banana-pro", "fields": ["..."] }],
  "source": "cron"
}
```

The changelog history is bounded already, so no additional cutoff policy is needed.

## Prerequisites

### `poe-code models` exact match support

Currently `--model` is a substring match (`includes()`), which can return multiple results. The discovery script needs exact single-model lookup.

**Change**: Make `--model` an exact match (case-insensitive) on the full model ID. Add `--search` for the current substring behavior, matching against both provider name (`owned_by`) and model ID.

| Flag         | Behavior (new)                                                  |
|--------------|-----------------------------------------------------------------|
| `--model`    | Exact match on model ID (case-insensitive). Returns 0 or 1.    |
| `--search`   | Substring match on both provider and model ID. Returns 0 or N. |
| `--provider` | Unchanged — substring match on `owned_by`.                     |

This is a separate code change in `src/cli/commands/models.ts` that should land first.

### GitHub App project permissions

The existing `POE_CODE_AGENT` GitHub App needs the `project` permission added (one-time settings change, not a code change). This allows the discovery workflow to add issues to `poe-platform/projects/3` via GraphQL.

## Design

### Three Event Types

**Added models**: A new model appears in `changelog[].added`.

**Removed models**: A model appears in `changelog[].removed`.

**Renamed models**: A model appears in `test_changelog.json[].renamed[]` as `{ from, to }`.

Each event type is tracked independently, even for the same model lineage.

### Persistence Keys (No Event Collisions)

Issue dedupe key must include event type:

- `added::<model_id>`
- `removed::<model_id>`
- `renamed::<old_id>-><new_id>`

This prevents a previous `New model: X` issue from suppressing a later `Removed model: X` issue.

### Triage: Specific Matching (Not Broad Grep)

Raw substring `grep` is too broad. Triage must use fixed-string evidence and version-aware checks.

For a model with ID `id` and owner `owned_by`, define:

- `model_id = id.toLowerCase()`
- `full_slug = ${owned_by.toLowerCase()}/${model_id}` when owner is known
- `family_key = version-stripped model family key` (used to detect older versions in code)

Evidence checks in `src/`:

1. `exact_mentions`: fixed-string matches for `model_id` and `full_slug`.
2. `predecessor_mentions` (for added/renamed): fixed-string matches for older models in same `family_key`.

Decision matrix:

- **Added**
  - `exact_mentions` OR `predecessor_mentions` found -> open issue + resolver.
  - No mentions -> closed tracking issue.
- **Removed**
  - `exact_mentions` found -> open issue + resolver.
  - No mentions -> closed tracking issue.
- **Renamed**
  - Mentions of old ID OR predecessor/new-family evidence -> open issue + resolver.
  - No mentions -> closed tracking issue.

### Single Workflow: Discover + Resolve

Use one workflow (`model-discovery.yml`) with two jobs:

1. `discover`
2. `resolve` (matrix over actionable issues from `discover`)

No dependency on issue-label event dispatch for this flow.

### Detection Logic

```text
json_feed    = GET https://models.poecdn.net/changelog.json
rename_feed  = GET https://models.poecdn.net/test_changelog.json

# Build candidates
added_events   = flatten(json_feed[*].added)
removed_events = flatten(json_feed[*].removed)
renamed_events = flatten(rename_feed[*].renamed)  # each item: { from, to }

# known keys from existing issues (open + closed)
# IMPORTANT: fetch labels separately (new-model, removed-model, renamed-model) and merge.
known_keys = {
  "added::<id>",
  "removed::<id>",
  "renamed::<from>-><to>"
}

for each added model id:
  key = "added::<id>"
  if key not in known_keys:
    metadata = poe-code models --model <id> --view raw
    triage with exact + predecessor checks
    create issue titled "New model: <id>" with labels ["new-model"] (+ resolver label if open)

for each removed model id:
  key = "removed::<id>"
  if key not in known_keys:
    triage exact mentions
    create issue titled "Removed model: <id>" with labels ["removed-model"] (+ resolver label if open)

for each renamed event from -> to:
  key = "renamed::<from>-><to>"
  if key not in known_keys:
    metadata = poe-code models --model <to> --view raw (best effort)
    triage old/new + predecessor evidence
    create issue titled "Renamed model: <from> -> <to>" with labels ["renamed-model"] (+ resolver label if open)

# for closed tracking issues:
# create issue first, then close via separate API call
```

## Implementation

### 0. Prerequisite: `poe-code models` exact match

**File**: `src/cli/commands/models.ts`

- Change `--model` from substring to exact match (case-insensitive) on `m.id`
- Add `--search <term>` — substring match on both `m.id` and `m.owned_by` (the current behavior of `--model`, plus provider matching)
- Update help text and tests

### 1. Workflow: `.github/workflows/model-discovery.yml`

```yaml
name: Model Discovery
on:
  schedule:
    - cron: "0 * * * *"   # every hour
  workflow_dispatch: {}     # manual trigger for testing

jobs:
  discover:
    name: Check for New Models
    runs-on: ubuntu-latest
    permissions:
      contents: read
      issues: write
      pull-requests: write
    outputs:
      actionable_issue_numbers: ${{ steps.discover.outputs.actionable_issue_numbers }}
      actionable_issue_count: ${{ steps.discover.outputs.actionable_issue_count }}
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: "22"
          cache: npm

      - name: Install and build
        run: npm ci && npm run build && npm install -g .

      - name: Generate GitHub App token
        id: app_token
        uses: actions/create-github-app-token@v1
        with:
          app-id: ${{ secrets.POE_CODE_AGENT_APP_ID }}
          private-key: ${{ secrets.POE_CODE_AGENT_PRIVATE_KEY }}

      - name: Discover models
        id: discover
        env:
          POE_API_KEY: ${{ secrets.POE_API_KEY }}
          GITHUB_TOKEN: ${{ steps.app_token.outputs.token }}
          GITHUB_REPOSITORY: ${{ github.repository }}
          PROJECT_NUMBER: "3"
          PROJECT_OWNER: "poe-platform"
        run: node scripts/workflows/discover-models.mjs

  resolve:
    name: Resolve Actionable Model Issues
    needs: [discover]
    if: ${{ needs.discover.outputs.actionable_issue_count != '0' }}
    strategy:
      fail-fast: false
      matrix:
        issue_number: ${{ fromJson(needs.discover.outputs.actionable_issue_numbers) }}
    runs-on: ubuntu-latest
    concurrency:
      group: model-discovery-issue-${{ matrix.issue_number }}
      cancel-in-progress: true
    steps:
      # setup + spawn resolver + create PR for matrix.issue_number
      # (same logic currently used for issue resolution, but executed here)
```

Uses the GitHub App token (not default `GITHUB_TOKEN`) for project operations and PR creation.

### 2. Script: `scripts/workflows/discover-models.mjs`

Standalone ESM script. Uses `fetch()` for changelog + GitHub API, `child_process.execFileSync` for `poe-code models` and exact-source checks.

```text
1. Fetch:
   - https://models.poecdn.net/changelog.json
   - https://models.poecdn.net/test_changelog.json
2. Compute event candidates for:
   - added
   - removed
   - renamed (from `renamed[]` objects)
3. Fetch all issues for each label category (new-model, removed-model, renamed-model), open + closed
4. Parse titles to build known event keys (type + identifier)

5. For each new added event:
   a. poe-code models --model <id> --view raw → metadata (best effort)
   b. Triage: exact mentions + predecessor-version mentions
   c. Create issue:
      - Title: "New model: <id>"
      - Labels: ["new-model"] + (["agent:claude-code"] if needs_changes)
      - Body: metadata YAML + triage reasoning
      - State:
        - open if needs_changes
        - closed if not (create then close)
   d. Add to project via GraphQL
   e. If open, append issue number to actionable outputs

6. For each new removed event:
   a. Triage: exact mentions
   b. Create issue:
      - Title: "Removed model: <id>"
      - Labels: ["removed-model"] + (["agent:claude-code"] if mentions found)
      - Body: triage evidence
      - State: open if mentions found, otherwise create then close
   c. Add to project
   d. If open, append issue number to actionable outputs

7. For each new renamed event (from -> to):
   a. poe-code models --model <to> --view raw → metadata (best effort)
   b. Triage: old/new exact mentions + predecessor-version mentions
   c. Create issue:
      - Title: "Renamed model: <from> -> <to>"
      - Labels: ["renamed-model"] + (["agent:claude-code"] if needs_changes)
      - Body: metadata + triage evidence
      - State: open if needs_changes, otherwise create then close
   d. Add to project
   e. If open, append issue number to actionable outputs

8. Emit workflow outputs:
   - actionable_issue_numbers (JSON array)
   - actionable_issue_count
9. Log summary
```

### 3. Add Issues to GitHub Project

GitHub Projects V2 uses GraphQL. The script needs to:

1. Look up the project node ID via GraphQL query on `poe-platform` org, project number 3
2. After creating each issue, add it via `addProjectV2ItemById` mutation

```graphql
mutation {
  addProjectV2ItemById(input: {
    projectId: "<project_node_id>"
    contentId: "<issue_node_id>"
  }) {
    item { id }
  }
}
```

### 4. Label setup

Labels to ensure exist: `new-model`, `removed-model`, `renamed-model`.

## File Changes

| File                                              | Change                                                              |
|---------------------------------------------------|---------------------------------------------------------------------|
| `src/cli/commands/models.ts`                      | `--model` exact match, add `--search` substring flag                |
| `src/cli/commands/models-command.test.ts`          | Tests for new `--model` / `--search` behavior                      |
| `.github/workflows/model-discovery.yml`           | New workflow — hourly cron + manual dispatch + inline resolver      |
| `.github/act-events/model-discovery.json`         | New event fixture for `act` testing                                 |
| `scripts/workflows/discover-models.mjs`           | New script — detect events, triage, create/close issues, emit outputs |
| `scripts/workflows/resolve-model-issue.cjs`       | New shared resolver entrypoint used by discovery resolve job         |

## Flow Diagram

```text
changelog.json
      │
      ▼
 ┌─────────────────────┐
 │ discover-models.mjs │
 │ (in model-discovery)│
 └──────────┬──────────┘
      │
      ├── added / removed / renamed, no change needed
      │      └──► create issue ─► close issue ─► project board
      │
      └── added / removed / renamed, change needed
             └──► open issue + agent:claude-code ─► resolve job matrix in same workflow ─► PR
```

## Edge Cases

- **Changelog down**: Script logs error and exits non-zero. Next hour retries.
- **`poe-code models` fails for a model**: Create issue without enrichment (just model name + note).
- **Duplicate prevention**: Event-aware keys prevent collisions across `added`, `removed`, and `renamed`.
- **Model removed then re-added**: `removed::<id>` and `added::<id>` are tracked independently, so both states can be represented.
- **Model renamed then removed**: `renamed` and `removed` are separate tracked states with separate issue keys.
- **Project API unavailable**: Log warning, still create the issue (project addition is best-effort).
- **Resolver fails in resolve job**: Keep issue open for manual handling; report failure summary in workflow logs.
- **Stale resolver runs**: Concurrency per issue number in resolve matrix with `cancel-in-progress: true`.

## QA: Local Testing with `act`

> After implementation, move these test cases to `docs/plans/qa-github-actions-act.md`.

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

### Event Fixtures Needed

| Fixture                                          | Description                            |
|--------------------------------------------------|----------------------------------------|
| `.github/act-events/model-discovery.json`        | Schedule trigger payload               |

## Verification

1. `act` dry-runs pass (TC-8, TC-9)
2. `npm run lint:workflows` validates all workflow YAML
3. `npm run test` and `npm run lint` for models command changes
4. `workflow_dispatch` trigger on GitHub for live testing
5. `node scripts/workflows/discover-models.mjs` locally with env vars set
