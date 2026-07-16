---
severity: medium
impact: usability
reproduced: y
recommendation: no-fix
evidence: "memory-mcp registered top-level at src/cli/commands/memory-mcp.ts:13 via src/cli/program.ts:892 but omitted from ROOT_HELP_COMMAND_SPECS (src/cli/program.ts:81-101), so it runs yet is absent from --help; 'agent' (src/cli/commands/agent.ts:19-21, one-shot Poe prompt) overlaps 'spawn poe-agent' (src/cli/program.ts:873)."
comment: "Cryptic ('memory-mcp top-level; agent vs spawn poe-agent.') but gestures at a real IA question - the overlap between 'agent' and 'spawn poe-agent' - which ux-agent-capability-matrix-spawn-vs-configure-vs-install.md addresses with actual evidence. Retire into that and the root-help cluster; too vague to action on its own."
---

# UX: Oddly shaped commands weak approval recovery

## Summary

memory-mcp top-level; agent vs spawn poe-agent.

## Evidence

IA.

## Why it matters

Footguns.

## Suggested direction

Nest; cross-links.

## Severity

Medium

## Area

IA
