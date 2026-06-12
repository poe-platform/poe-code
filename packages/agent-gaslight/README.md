# @poe-code/agent-gaslight

Run one agent conversation across an initial plan prompt and an ordered list of follow-up prompts.

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

`prompt` and `followups` must be non-empty. Pass both directly to `runGaslight` to bypass configuration lookup.

## SDK

```ts
import { runGaslight } from "@poe-code/agent-gaslight";

const result = await runGaslight({
  planPath: "docs/plans/feature.md",
  agent: "claude-code",
  model: "Claude-Sonnet-4.5"
});
```

## Options

- `planPath`: Required plan path, resolved from `cwd`.
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

The result contains each round's prompt, summary, and thread id plus summed token and cost usage when the agent reports usage.
