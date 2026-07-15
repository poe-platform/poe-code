---
severity: medium
impact: discoverability
comment: "The best-argued of the spawn help filings and it supersedes the contentless ux-spawn-advanced-flags-undifferentiated.md: it groups the offenders precisely (ACP JSONL logging, OpenTelemetry, the raw MCP JSON schema in a description) and explains why each is inappropriate for the product's most-used command - 'ACP JSONL' and 'OpenTelemetry' are internal vocabulary in user-facing help. Its fix is right and pairs with the examples ask: group advanced flags, show one MCP example instead of the schema. Consolidate the spawn help cluster here."
---

# UX: spawn --help exposes internal infrastructure flags at the user level

## Summary

`poe-code spawn --help` (the primary agent-run command) surfaces multiple groups of internal infrastructure flags that most users will never need:

### Logging infrastructure
```
--log-dir <path>        Directory override for ACP JSONL spawn logs
--log-file-name <name>  Filename override for the spawn log
--log-content           Include message and tool content in ACP JSONL spawn logs
```
"ACP JSONL" is an internal protocol. Users have no context for what these flags do or when to use them.

### OpenTelemetry
```
--capture-otel          Capture native OpenTelemetry emitted by the spawned agent
--capture-otel-content  Include prompt and tool content in native OpenTelemetry
```
OpenTelemetry is a developer observability framework. These are not user-facing features.

### MCP servers JSON schema in description
```
--mcp-servers <json|@file>   MCP server config JSON (or @path/to/file.json): {name: {command, args?, env?}}
```
The raw JSON schema `{name: {command, args?, env?}}` is embedded directly in the help description. Users cannot parse this without external docs.

## Why it matters

`spawn` is the most-used command in poe-code. Its help output being padded with infrastructure flags makes it harder to find the core options (agent, model, mode, prompt). New users will be overwhelmed.

## Suggested direction

Hide or group logging, OTEL, and hook flags in an "Advanced" section. Document `--mcp-servers` format with an example rather than a raw schema.

## Severity

Medium

## Area

Spawn / help / flag discoverability / infrastructure exposure
