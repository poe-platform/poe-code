# @poe-code/braintrust

Optional Braintrust observability for poe-code's agent-running surfaces: standalone spawn, pipeline, superintendent, and experiment-loop. When enabled, it wires Braintrust spans and experiment rows into the existing runtimes without changing run semantics; Braintrust SDK failures are recorded in integration status and the poe-code command keeps running.

## Setup

`braintrust` is an optional peer dependency. Install it in the workspace or project that runs poe-code:

```sh
npm i braintrust
```

## Configuration

Configure the integration under `integrations.braintrust` in poe-code config:

```json
{
  "integrations": {
    "braintrust": {
      "enabled": true,
      "apiKey": "${BRAINTRUST_API_KEY}",
      "project": "poe-code",
      "apiUrl": "https://api.braintrust.dev"
    }
  }
}
```

Keys:

| Key | Type | Meaning |
| --- | --- | --- |
| `enabled` | `boolean` | Enables or disables Braintrust integration. Defaults to `false`. When not `true`, the Braintrust package is not loaded. |
| `apiKey` | `string` | Braintrust API key. Required when `enabled` is `true`; commonly supplied through config interpolation as `${BRAINTRUST_API_KEY}`. |
| `project` | `string` | Braintrust project name used for logs and experiment rows. Required when `enabled` is `true`. |
| `apiUrl` | `string` | Optional Braintrust API URL override for non-default deployments or proxies. |

## Environment Variables

| Variable | Meaning |
| --- | --- |
| `BRAINTRUST_API_KEY` | Braintrust API key. This package does not read the environment directly; use config interpolation, for example `"apiKey": "${BRAINTRUST_API_KEY}"`. |

## What Lands In Braintrust

All surfaces use `task` spans for orchestrator, step, role, agent, and iteration work. ACP tool calls use `tool` spans. Token usage and durations are logged as numeric metrics where available: `prompt_tokens`, `completion_tokens`, `tokens`, `prompt_cached_tokens`, `prompt_cache_creation_tokens`, and `durationMs`.

Pipeline runs create one root run span, one child span per pipeline step, and nested agent/tool spans for spawned work:

```text
pipeline:<name>
├── step:<step>:<index>
│   └── agent:<agent>:<model>
│       ├── tool_call:<kind>
│       └── tool_call:<kind>
└── step:<step>:<index>
    └── agent:<agent>:<model>
        └── tool_call:<kind>
```

Superintendent runs create a root run span with role spans for each loop participant. Spawned role work appears below the role span:

```text
superintendent:<name>
├── role:builder
│   └── agent:<agent>:<model>
│       └── tool_call:<kind>
├── role:inspector
├── role:superintendent
└── role:owner
```

Experiment-loop runs create a root run span and Braintrust experiment rows for each iteration:

```text
experiment:<name>
└── iteration:<n>
    └── agent:<agent>:<model>
        └── tool_call:<kind>
```

Standalone spawn creates a root spawn trace with the agent span and any ACP tool calls:

```text
spawn:<name>
└── agent:<agent>:<model>
    ├── tool_call:<kind>
    └── tool_call:<kind>
```

## Failure Modes

- Missing peer dependency: when `enabled` is `true` but `braintrust` is not installed, bootstrap fails with `Braintrust integration is enabled but the 'braintrust' package is not installed. Run: npm i braintrust`.
- Missing `apiKey`: when `enabled` is `true` and `apiKey` is empty or absent, bootstrap fails with `Braintrust integration is enabled but apiKey is missing`.
- Missing `project`: when `enabled` is `true` and `project` is empty or absent, bootstrap fails with `Braintrust integration is enabled but project is missing`.
- Network or SDK errors: SDK initialization, logging, and flush failures are recorded in integration status and swallowed so the orchestrator can continue.

## Status

Use the CLI status command to inspect the resolved integration state:

```sh
poe-code braintrust status
```

It reports disabled configuration, missing fields, missing peer dependency, or the enabled project with the latest recorded Braintrust error count.
