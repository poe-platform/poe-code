# @poe-code/agent-gaslight

Runs a plan through one agent conversation, then sends scripted follow-up prompts in the same thread.

Use it when a task needs repeated checks such as simplify, test, commit, and push verification.

## How it works

1. Round 1: the agent gets your plan and implements it.
2. Rounds 2..n: each follow-up prompt resumes the same conversation.
3. You get a summary per round plus total token and cost usage.

## Example follow-ups

```yaml
prompt: Implement
auto-archive: false
followups:
  - Can this be simpler?
  - Did you test the real workflow?
  - Did you commit the changes?
```

## Configuration

The package loads the first existing file in this order:

1. `<cwd>/.poe-code/gaslight.yaml`
2. `<homeDir>/.poe-code/gaslight.yaml`

```yaml
agent: claude-code
vars:
  context: '{{file "context.md"}}'
prompt: Implement
auto-archive: false
followups:
  - Review {{context}}
  - Did you test the real workflow?
  - Did you commit the changes?
```

`prompt` and `followups` must be non-empty. `agent`, `vars`, and `auto-archive` are optional; `auto-archive` defaults to `false`. Variables use `{{name}}` placeholders in setup, prompt, follow-ups, and teardown. A variable value can include project-relative file content with `{{file "path"}}`; paths outside the project are rejected. CLI flags override the configured agent and model. Pass `prompt`, `followups`, and optional `vars` directly to `runGaslight` to bypass configuration lookup.

## CLI

```sh
poe-code gaslight docs/plans/feature.md --agent claude-code --model <model-id>
poe-code gaslight docs/plans/feature.md --archive
```

Omit the plan path to pick one interactively from your plans directory.
After a successful session, the CLI lists every completed plan and shows its archive destination when applicable.

The CLI also honors `{ "gaslight": { "archive": true } }`; use `--archive` or `--no-archive` for a one-off override.

Create `gaslight.yaml` at project or user scope:

```sh
poe-code gaslight install --local
poe-code gaslight install --global
```

Use `--force` to replace an existing config file. Existing configs are otherwise preserved.

Generate a config from local Claude and Codex traces:

```sh
poe-code gaslight ingest --agent claude-code --sources claude,codex --since 30d --limit 200
```

By default, ingest writes a temporary curated Markdown analysis input under `<cwd>/.poe-code/ingest/` so the analysis agent can read it from the workspace, then deletes it after analysis. Pass `--keep-data <path>` to preserve the file for inspection.

## Environment Variables

This package does not read public environment variables directly. The CLI resolves agents, config, and workspace paths before calling the package runner.

## SDK

```ts
import { runGaslight } from "@poe-code/agent-gaslight";

const result = await runGaslight({
  planPaths: ["docs/plans/feature.md"],
  agent: "claude-code",
  model: "<model-id>"
});
```

## Run options

- `planPaths`: Required plan paths, resolved from `cwd`.
- `agent`: Agent identifier. Required unless configured in `gaslight.yaml`.
- `model`: Optional model override.
- `mode`: Optional spawn mode: `yolo`, `auto`, `edit`, or `read`. When omitted, `agent-spawn` uses `auto`.
- `archive`: Move each plan under sibling `archive/` after all rounds succeed. Defaults to `false`.
- `cwd`: Working directory. Defaults to `process.cwd()`.
- `homeDir`: Home directory used for global config lookup. Defaults to `os.homedir()`.
- `prompt`: Initial prompt. Must be provided together with `followups`.
- `followups`: Ordered follow-up prompts. Must be provided together with `prompt`.
- `vars`: Optional string values interpolated into setup, prompt, follow-ups, and teardown.
- `onEvent`: Receives round start and finish events.
- `signal`: Abort signal forwarded to every spawn.
- `fs`: Injectable filesystem for tests and custom hosts.
- `spawn`: Injectable agent spawn function for tests and custom hosts.

After all rounds for a plan finish successfully, Gaslight leaves the plan file in place unless `archive` is enabled. The run result contains each round's prompt, summary, and thread id, plus summed token and cost usage when the agent reports usage.

## Ingest options

- `sources`: Optional trace sources. Supported values are `claude` and `codex`.
- `analysisAgent`: Required agent identifier for prompt analysis.
- `model`: Optional model override for the analysis agent.
- `cwd`: Working directory. Defaults to `process.cwd()`.
- `homeDir`: Home directory used to find local trace stores. Defaults to `os.homedir()`.
- `since`: Duration string or date used to filter recent traces. Defaults to `30d`.
- `limit`: Maximum extracted human prompts. Defaults to `200`.
- `allWorkspaces`: Read traces from every workspace instead of only `cwd`.
- `outputPath`: Generated gaslight config path. Defaults to `.poe-code/gaslight.yaml` or an agent-prefixed variant when that file exists.
- `keepDataPath`: Persist curated analysis input at this path. Without it, ingest writes a temporary Markdown file under `.poe-code/ingest/` and deletes it after analysis.
- `dryRun`: Count the traces and prompts that would be analysed, then return the paths that would be written without spawning the analysis agent or writing any file.
- `onEvent`: Receives ingest progress events.
- `fs`: Injectable filesystem for tests and custom hosts.
- `spawn`: Injectable agent spawn function for tests and custom hosts.
- `collectHumanPrompts`: Injectable trace collector for tests and custom hosts.

The ingest result contains the generated config path, prompt data path, prompt count, and trace count.
