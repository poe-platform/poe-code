# agent-code-review

Internal package for agent-assisted GitHub code review. It owns code-review configuration, SDK run-option resolution, Markdown profile and prompt loading, YAML review state, the Toolcraft CLI group, and the spawned-agent MCP process.

## Repo-local assets

- `.poe-code/code-review/profiles` holds reviewer profile Markdown files. Profiles are read from `*.md`; when none exist, runtime exposes the built-in `generic` profile only.
- `.poe-code/code-review/prompts` holds `{orchestrator,subagent,agent,profile-synthesis}.md`. Each missing role prompt falls back to its built-in prompt.
- `.poe-code/code-review/reviews` is the default YAML draft-state store. Published review state moves into its `archive` subdirectory.
- `.poe-code/code-review/ingest` records ingest evidence under `<profile>/{source.yaml,comments.jsonl,synthesis-prompt.md}` before a synthesized profile is written.
- Profile Markdown may start with YAML frontmatter `version: 1` and `name: <filename-without-.md>`; prompt Markdown may start with `version: 1` and `role: <prompt-role>`.
- Install starter assets with `poe-code code-review install --cwd <repo>`; pass `--force` to overwrite existing files, or `--dry-run` to preview them first.

## Configuration

Configuration uses the normal `.poe-code/config.json` hierarchy under the `codeReview` scope:

```json
{
  "codeReview": {
    "agent": "codex",
    "draftStore": ".poe-code/code-review/reviews",
    "profileDirectories": ["/srv/reviewer-profiles"],
    "humanGate": { "provider": "none" }
  }
}
```

- `agent` is optional. When omitted, agent selection remains with normal `poe-code` default-agent resolution.
- `draftStore` defaults to `.poe-code/code-review/reviews` and contains one YAML state file per PR, named `<org>_<repo>_PR<number>.yaml`.
- Published review files are moved to `.poe-code/code-review/reviews/archive`; archive filename collisions receive a timestamp suffix.
- Review YAML and ingest `source.yaml` documents use `version: 1`; malformed documents report the path and failing field on read.
- `humanGate.provider` defaults to `none`.

## Environment Variables

The package defines no environment variables of its own. Runtime review does not require `OPENAI_API_KEY`; only `gh` CLI authentication and a configured `poe-code` agent are needed.

## SDK

- `loadCodeReviewConfig` resolves project and user configuration.
- `resolveCodeReviewRunOptions` merges explicit SDK input over configured defaults and leaves `agent` absent when normal `poe-code` default-agent resolution should apply.
- `loadCodeReviewProfile` and `loadCodeReviewPrompt` load non-empty Markdown assets.
- `parseCodeReviewState` and `serializeCodeReviewState` own YAML state interchange.
- `CodeReviewYamlStore` starts PR runs, archives prior rerun state, adds immutable raw reviews, permits exactly one merged review, appends orchestrator actions, and archives files after publishing.
- `readCodeReviewDraft` returns the merged YAML draft for a pull request when one exists.
- `commitCodeReviewDrafts` validates the final merged inline comments against the current PR diff, publishes one GitHub review, records the publishing receipt, and archives its YAML state.
- `createCodeReviewAgentMcpConfig` creates an argument-bound MCP configuration passed to spawned review agents; it passes `--role`, `--session`, `--actor`, `--cwd`, `--draft-store`, `--agent`, and optional `--profiles` explicitly.
- `runCodeReview` resolves runtime config, session and agent selection; fetches PR metadata, diff, and prior review activity through `github-review`; includes optional external feedback in the orchestrator prompt; initializes YAML state; and spawns the orchestrator through the `poe-code` SDK.
- `ingestCodeReviewProfile` fetches normalized review-history records through `github-review`, records `.poe-code/code-review/ingest/<profile>/{source.yaml,comments.jsonl,synthesis-prompt.md}`, and spawns the selected agent to write `.poe-code/code-review/profiles/<profile>.md` directly.
- The orchestrator can call `code_review_agent_spawn` for profile reviewers. Each subagent may override `agent`; omitted overrides inherit the run agent, and each resolved agent is persisted in YAML.

## Recovery and resume

- Re-running `code-review run <pr>` resumes an active YAML file: `merged_review` is cleared for regeneration, immutable `raw_reviews` from the prior run are discarded so the new PR diff is reanalyzed, and a `resumed_run` orchestrator action is appended.
- On resume, prior raw reviews and subagent statuses are cleared so each selected profile reruns against the latest pull request diff.
- Publication records `publication_started` before submitting to GitHub. If a process dies before a receipt can be persisted, rerunning `commit <pr>` refuses to risk a duplicate review; a known failed submit records `publication_failed` and permits a retry.
- If the published receipt was persisted before interruption, rerunning `commit <pr>` archives that receipt without making another GitHub submission. Existing archive names are preserved and new archives use timestamped suffixes on collision.
- Ingest writes `comments.jsonl`, `source.yaml`, and the synthesis prompt atomically. A rerun replaces an interrupted partial `comments.jsonl` artifact rather than appending to corrupt evidence.

## CLI

The root CLI forwards `poe-code code-review ...`, but the group is intentionally hidden from root help. Use `poe-code code-review --help` for the command list.

- `install`: run `poe-code code-review install [--cwd <repo>] [--force] [--dry-run]` to install repo-local starter profiles and prompts. `--dry-run` reports the files it would create, overwrite, or skip and writes nothing.
- `profiles`: run `poe-code code-review profiles [--cwd <repo>]` to list available reviewer profiles. Add or edit `.poe-code/code-review/profiles/*.md`, or rely on the built-in `generic` fallback when the directory contains no profiles.
- `prompt-preview`: run `poe-code code-review prompt-preview --spawn <orchestrator|reviewer|profile-synthesis> [--profile <name>] [--cwd <repo>]` to render the exact effective spawn prompt without GitHub, model, or agent calls.
- `ingest`: run `poe-code code-review ingest <github-username> --repo <owner/name> [--repo <owner/name>...] [--profile <name>] [--agent <agent>] [--cwd <repo>]` to synthesize a profile from authored GitHub review history; repeat `--repo` for each source repository.
- `run`: run `poe-code code-review run <github-pr-url> [--cwd <repo>] [--agent <agent>] [--draft-store <dir>] [--profile-path <path>] [--prompt-path <path>] [--profiles <profile>...] [--additional-feedback <text>]` to fetch the PR, launch review agents, and create a merged YAML draft without publishing it.
- `drafts`: run `poe-code code-review drafts <github-pr-url> [--cwd <repo>] [--draft-store <dir>]` to read the active YAML draft.
- `commit`: run `poe-code code-review commit <github-pr-url> [--cwd <repo>] [--draft-store <dir>] [--actor <name>] [--dry-run]` to validate and publish the final merged review. `--dry-run` returns only the payload that would be submitted and leaves YAML state active.
- `agent-mcp`: run `poe-code code-review agent-mcp --role <agent|orchestrator|subagent> --session <id> --actor <name> --cwd <repo> [--draft-store <dir>] --agent <agent> [--profiles <csv>] [--profile-directories <csv>]` to start the stdio MCP process intended for spawned review agents.

## Prompt composition and preview

Repo-local role prompts live in `.poe-code/code-review/prompts/*.md`. A plain Markdown file remains a complete replacement for the built-in role prompt. To add a small policy layer while retaining the packaged default, use the shared prompt-document composition format:

```md
---
extends: true
---

Apply the repository security policy before reviewing.

{{yield}}
```

The public `previewCodeReviewSpawnPrompt(...)` SDK returns the final prompt plus `promptDocument` provenance, including the resolved source chain. Preview uses deterministic placeholder PR context unless callers provide `prUrl`, `prDetails`, `diff`, or `priorActivity` values.

- Agents and subagents receive PR read tools plus `code_review_create_draft` only.
- Orchestrators additionally receive profile/spawn/status and draft-management tools.
- `code_review_commit_drafts` is MCP dry-run preview only; spawned agents never receive a GitHub publishing tool.

## CI usage

Pass the full GitHub pull request URL explicitly in CI; do not rely on local branch inference. `github-review` invokes `gh`, so expose `GH_TOKEN` to the job with permissions required to read the PR and, only for a publishing `commit`, submit a review:

```sh
GH_TOKEN="$GH_TOKEN" poe-code code-review run \
  "https://github.com/acme/widgets/pull/123" \
  --cwd "$GITHUB_WORKSPACE"

GH_TOKEN="$GH_TOKEN" poe-code code-review commit \
  "https://github.com/acme/widgets/pull/123" \
  --cwd "$GITHUB_WORKSPACE" \
  --actor github-actions
```

Use `commit --dry-run` before enabling publication in a pipeline that is still being configured.

## External profile catalogs

Embedding services can configure absolute central catalog directories through `codeReview.profileDirectories`, or pass the same `profileDirectories` array to `runCodeReview` and `discoverCodeReviewProfiles`. The `profiles` command and spawned reviewer agents use the same configured catalogs.

```ts
await runCodeReview({
  prUrl: "https://github.com/acme/widgets/pull/123",
  cwd: "/srv/checkouts/widgets",
  profileDirectories: ["/srv/reviewer-profiles"]
});
```

Profile precedence is deterministic: repo-local profiles win first, then external directories in configured order. An exact-name collision keeps the first profile; names that differ only by Unicode normalization or case are rejected. The built-in `generic` profile is used only when neither repo-local nor external catalogs contain profiles.

## External human gates

Slack approval, ticketing, or any other human-gate integration belongs outside `poe-code`. An embedding service can collect feedback and rerun the SDK with `additionalFeedback`; `runCodeReview` includes that text in the orchestrator context for the next draft:

```ts
await runCodeReview({
  prUrl: "https://github.com/acme/widgets/pull/123",
  cwd: process.cwd(),
  additionalFeedback: "Please verify rollback coverage before approval."
});
```

There is intentionally no Slack client, webhook handler, reaction polling, or Slack-specific publication logic in `poe-code` or this package.
