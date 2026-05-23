# `agent-code-review`

Internal package for the agent-assisted GitHub review workflow. It is the home for code-review configuration, SDK resolution, Markdown profile/prompt loading, YAML draft state, the Toolcraft CLI group, and the review-agent MCP process.

## Configuration

Configuration is read from the normal `.poe-code/config.json` hierarchy under the `codeReview` scope:

```json
{
  "codeReview": {
    "agent": "codex",
    "draftStore": ".poe-code/code-review/reviews",
    "humanGate": { "provider": "none" }
  }
}
```

- `agent` is optional. When omitted, code review leaves agent selection to the normal `poe-code` default-agent resolution.
- `draftStore` defaults to `.poe-code/code-review/reviews` and contains YAML review state.
- `humanGate.provider` defaults to `none`; external integrations can pass feedback through SDK input rather than adding provider-specific runtime code here.

The package defines no `AUTOMATIONS_*` environment variables and runtime review does not require `OPENAI_API_KEY`.

## SDK

- `loadCodeReviewConfig` reads resolved `codeReview` configuration.
- `resolveCodeReviewRunOptions` combines SDK review input with config; explicit SDK values win over config values.
- `loadCodeReviewProfile` and `loadCodeReviewPrompt` load non-empty Markdown assets.
- `parseCodeReviewState` and `serializeCodeReviewState` own YAML review-state interchange.
- `createCodeReviewAgentMcpConfig` returns the stdio MCP config used when review agents are spawned.

## CLI Surface

`codeReviewGroup` exposes `code-review agent-mcp`, a stdio MCP entry point intended for spawned review agents. Review commands and MCP tools are added to this package as the review orchestration workflow is implemented.
