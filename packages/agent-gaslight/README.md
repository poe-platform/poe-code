# @poe-code/agent-gaslight

Every coding agent has the same flaw: it declares victory too early. "Done! ✨" — with uncommitted changes, untested code, and a TODO it quietly decided was out of scope.

You already know the fix. You lean in and type _"did you actually test this?"_ and the agent goes _"You're absolutely right!"_ and finds three bugs. Then _"did you commit?"_ and it sheepishly commits. You are not pair programming, you are babysitting.

Gaslight automates the babysitting. It runs your plan through one agent conversation, then follows up with a scripted list of pointed questions — each one resuming the same thread, so the agent has to face its own work.

## How it works

1. Round 1: the agent gets your plan and implements it.
2. Rounds 2..n: each follow-up prompt resumes the same conversation.
3. You get a summary per round plus total token and cost usage.

The agent can't claim it's done until it has survived every question.

## Use cases

**The amnesiac committer.** The agent writes beautiful code and walks away leaving `git status` a mess. Follow up with:

```yaml
followups:
  - Did you commit the changes?
```

**The optimistic tester.** "All tests pass" (it ran one unit test, once, on the happy path). Follow up with:

```yaml
followups:
  - Did you test it well? Like real end to end test?
```

**The premature simplifier-in-reverse.** First drafts are always over-engineered. Follow up with:

```yaml
followups:
  - Is this best you can do? Maybe we could simplify a bit.
```

**The full guilt trip.** Chain them. Order matters — simplify before you test, test before you commit, commit before you push:

```yaml
prompt: Implement
followups:
  - Is this best you can do? Maybe we could simplify a bit.
  - Did you test it well? Like real end to end test?
  - Did you commit the changes?
  - Did you push the changes and waited for release to go green?
```

## Environment variables

This package exposes no environment variables. It delegates agent execution to `@poe-code/agent-spawn`, so spawned agents may still require their usual credentials or CLI environment.

## Configuration

The package loads the first existing file in this order:

1. `<cwd>/.poe-code/gaslight.yaml`
2. `<homeDir>/.poe-code/gaslight.yaml`

```yaml
prompt: Implement
followups:
  - Is this best you can do?
  - Did you test it well? Like real end to end test?
  - Did you forget something?
```

Supported config keys:

- `prompt`: Required non-empty string used for the initial implementation round.
- `followups`: Required non-empty array of non-empty strings. Each follow-up resumes the previous round's thread.

Pass both directly to `runGaslight` to bypass configuration lookup.

## CLI

```sh
poe-code gaslight docs/plans/feature.md --agent claude-code --model Claude-Sonnet-4.5
```

Omit the plan path to pick one interactively from your plans directory.

Scaffold `gaslight.yaml` at project or user scope:

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

CLI options:

- `--agent <agent>`: Agent id to run. Without `--yes`, omitted values are prompted.
- `--model <model>`: Optional model override.
- `--mode <read|edit|yolo>`: Spawn mode. Defaults to `edit`.
- `install --local`: Write `<cwd>/.poe-code/gaslight.yaml`.
- `install --global`: Write `<homeDir>/.poe-code/gaslight.yaml`.
- `install --force`: Replace an existing config.

## SDK

```ts
import { runGaslight } from "@poe-code/agent-gaslight";

const result = await runGaslight({
  planPaths: ["docs/plans/feature.md"],
  agent: "claude-code",
  model: "Claude-Sonnet-4.5"
});
```

## Run options

- `planPaths`: Required plan paths, resolved from `cwd`.
- `agent`: Required agent identifier.
- `model`: Optional model override.
- `mode`: Spawn mode: `read`, `edit`, or `yolo`. Defaults to `edit`.
- `cwd`: Working directory. Defaults to `process.cwd()`.
- `homeDir`: Home directory used for global config lookup. Defaults to `os.homedir()`.
- `prompt`: Initial prompt. Must be provided together with `followups`.
- `followups`: Ordered follow-up prompts. Must be provided together with `prompt`.
- `onEvent`: Receives round start and finish events.
- `signal`: Abort signal forwarded to every spawn.
- `fs`: Injectable filesystem for tests and custom hosts.
- `spawn`: Injectable agent spawn function for tests and custom hosts.

After all rounds for a plan finish successfully, Gaslight leaves the plan file in place. The run result contains each round's prompt, summary, and thread id, plus summed token and cost usage when the agent reports usage.

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
- `onEvent`: Receives ingest progress events.
- `fs`: Injectable filesystem for tests and custom hosts.
- `spawn`: Injectable agent spawn function for tests and custom hosts.
- `collectHumanPrompts`: Injectable trace collector for tests and custom hosts.

The ingest result contains the generated config path, prompt data path, prompt count, and trace count.

## FAQ

**Isn't this just nagging?** Yes. It works on agents for the same reason it works on people, except the agent never gets annoyed and the questions never get old.

**Is it actually gaslighting?** Technically no — gaslighting would be telling the agent it never wrote the code. We just ask it leading questions until it doubts itself productively. The name stays.
