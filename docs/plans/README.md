# Active Plans

Only keep plans here when they describe work that is still relevant and not fully shipped.

## Current Plan Set

| Plan                                                                | Why It Stays Active                                                                                            |
| ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| [Spawn hooks](15-spawn-hooks.md)                                    | No `SpawnPlugin`/builder API exists in `agent-spawn` yet.                                                      |
| [Toolcraft YAML output](23-toolcraft-yaml-output.md)                | `packages/toolcraft` still limits `OutputMode` to `rich`, `md`, and `json`.                                    |
| [Agent goal](32-agent-goal.md)                                      | No `@poe-code/agent-goal` package, goal CLI, or goal MCP tools exist yet.                                      |
| [Apple container e2e runner](apple-container-e2e-runner.md)         | `@poe-code/e2e-test-runner` supports `env`, `sandbox`, and `podman`; no `apple-container` backend exists.      |
| [Gaslight crash resume](gaslight-crash-resume.md)                   | Gaslight resumes within one run by thread id, but lacks durable checkpoint/resume/reset state.                 |
| [Poe Agent plugin model options](poe-agent-plugin-model-options.md) | OpenAI Responses plugin options still use repo-specific parsed fields instead of provider-native pass-through. |

## QA Notes

- [Plan QA notes](qa/README.md)
- [Design-system own prompts](qa/27-design-system-own-prompts.md)
- [Providers QA](qa/providers.md)

## Archive Rule

Move a plan to `docs/plans/archive/` when one of these is true:

- The feature is shipped and covered by package docs.
- The plan is an investigation with recorded decisions and verification.
- The direction is obsolete or contradicted by current architecture.
- The remaining work is small enough to track in an issue or package README instead of a full plan.

Archived plans are summarized at [archive/README.md](archive/README.md).
