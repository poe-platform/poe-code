# @poe-code/ralph

Autonomous agent loop for executing YAML-based plans story by story.

## Usage

```ts
import { ralphBuild, ralphPlan } from "@poe-code/ralph";

// Generate a plan from a user request
await ralphPlan({
  request: "Build a CLI tool that converts CSV to JSON",
  outPath: ".poe-code-ralph/plan.yml",
  agent: "claude-code"
});

// Execute the plan
const result = await ralphBuild({
  planPath: ".poe-code-ralph/plan.yml",
  maxIterations: 20,
  agent: "claude-code"
});
```

## Plan Format

```yaml
version: 1
project: my-project
overview: Brief description
goals: [...]
qualityGates:
  - npm run test
  - npm run lint
stories:
  - id: US-001
    title: Implement feature X
    status: open
    dependsOn: []
    acceptanceCriteria:
      - Criterion 1
```

## API

| Export | Description |
|--------|-------------|
| `ralphBuild(options)` | Run the build loop |
| `ralphPlan(options)` | Generate a plan from a request |
| `resolvePlanPath(options)` | Find plan file in standard locations |
| `loadConfig()` | Load `.poe-code-ralph/config.yml` |
| `logActivity(options)` | Append to activity log |

## CLI Commands

```bash
# Install templates and /plan skill (prompts for agent and scope)
poe-code ralph install [--agent <name>] [--local|--global] [--force]

# Generate a plan from a request
poe-code ralph plan "Build a CSV to JSON converter" --out .poe-code-ralph/plan.yml

# Run the build loop
poe-code ralph build [iterations] --plan <path> --agent <name> [--[no-]commit] [--pause-on-overbake]

# Log activity (used by agents)
poe-code ralph agent log "Started work on US-001"

# Validate plan YAML (used by agents)
poe-code ralph agent validate-plan --plan <path>
```

## Skills

After running `ralph install`, the `/poe-code-ralph-plan` skill is available in your agent:

```
/poe-code-ralph-plan Build a REST API with user authentication
```

This generates a plan YAML file that can be executed with `ralph build`.

## Testing

```ts
import { simulateBuildLoop } from "@poe-code/ralph/testing";

const result = await simulateBuildLoop({
  prd: planYaml,
  turns: [
    { exitCode: 0, stdout: "<promise>COMPLETE</promise>" }
  ]
});
```
