---
severity: low-medium
impact: usability
reproduced: y
recommendation: fix
evidence: "src/cli/mcp-spawn-config.ts:30 wraps missing --mcp-servers files in ValidationError with flag context, while packages/agent-gaslight/src/config.ts:118 awaits fs.readFile unguarded so gaslight --config <missing> surfaces a raw ENOENT; harness/pipeline use ad-hoc pathExists helpers (src/cli/commands/harness.ts:543, src/cli/commands/pipeline.ts:802) - message classes do vary."
comment: "Contentless, but its instinct is the most useful in this set: path-not-found messages vary across commands (compare the ENOENT filings for gaslight --config, harness run and traces), so a shared ValidationError helper would fix a family rather than one flag. Reframe it that way and attach the ENOENT cluster to it; as written it adds nothing to the --mcp-servers positives."
---

# UX: --mcp-servers missing file pattern

## Summary

Good message class vary.

## Evidence

@/tmp/no-mcp.json.

## Why it matters

Standardize path errors.

## Suggested direction

Shared ValidationError helper.

## Severity

Low–Medium

## Area

Errors / consistency
