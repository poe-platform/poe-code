---
severity: medium
impact: discoverability
comment: "Duplicate within the spawn-only family; retire. Its fairness is worth carrying: it concedes the rejection is correct behavior - pi genuinely is not configurable - so the only defect is the wording, which ux-skill-configure-pi-poe-agent-not-supported-clear.md already solves ('Skills not supported for pi'). Adopt that phrasing here."
---

# UX: unconfigure rejects spawn-only agents pi/poe-agent as unknown

## Summary

unconfigure pi and unconfigure poe-agent: Unknown agent — correct that they are not configurable, but error does not say spawn-only / not configurable; same as typo unknown agent without allow-list of configurable agents.

## Evidence

```bash
$ poe-code unconfigure pi
■  Error: Unknown agent "pi".
$ poe-code unconfigure poe-agent
■  Error: Unknown agent "poe-agent".
```
spawn accepts pi and poe-agent.

## Why it matters

Capability matrix: list configurable agents; message pi is spawn-only.

## Suggested direction

Agent capability matrix; ValidationError with configurable list.

## Severity

Medium

## Area

Unconfigure
