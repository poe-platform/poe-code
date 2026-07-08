# UX: claude-fable-* appears in agent-traces test fixtures (note)

## Summary

claude-fable-5 appears in packages/agent-traces test fixtures and archived plans as fixture model ids. Live settings corruption to claude-fable-5[1m] may come from concurrent agent/trace activity writing settings, not product FRONTIER_MODELS. Still need protect live config from garbage writes.

## Evidence

packages/agent-traces/src/readers/claude.test.ts uses model: "claude-fable-5"
Live settings intermittently became claude-fable-5[1m] + xhigh during audit.

## Why it matters

Sources of live model corruption may include concurrent agents writing settings; product must validate on write and doctor should detect.

## Suggested direction

Validate model on settings write; doctor; never write fixture ids to live config.

## Severity

**High**

## Area

Config / models
