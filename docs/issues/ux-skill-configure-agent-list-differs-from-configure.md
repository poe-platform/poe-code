---
severity: medium
impact: polish
reproduced: y
recommendation: fix
evidence: "skill.ts:181 uses supportedAgents from configs.ts:39 (6 canonical ids, no aliases) while configure lists 11 including aliases; but resolveAgentSupport -> resolveAgentId maps claude/cursor-agent/gemini to supported ids (dry-run 'skill configure claude' resolves to claude-code) and kimi errors 'Skills not supported for kimi.', so only the help text is out of sync"
comment: "Keep as canonical of this pair: the only filing with both lists side by side, correctly naming all five missing agents. Its scenario is the concrete cost - a user who ran 'configure claude' will try 'skill configure claude' and fail on an alias the sibling command accepts. Its first suggestion is right and matches the capability-matrix cluster: derive both lists from one source. If some agents genuinely lack skill support, say so rather than omitting them silently - ux-skill-configure-kimi-not-supported-clear.md shows the good wording already exists."
---

# UX: skill configure --help agent list is a subset of configure --help agent list

## Summary

`skill configure [agent]` lists supported agents as:
```
claude-code | codex | cursor | gemini-cli | opencode | goose
```

`configure [agent]` lists:
```
claude-code | claude | codex | cursor | cursor-agent | gemini-cli | gemini | goose | kimi | kimi-cli | opencode
```

Five agents are missing from `skill configure`: `claude`, `cursor-agent`, `gemini`, `kimi`, `kimi-cli`.

## Why it matters

A user who configured their agent as `claude` via `poe-code configure` will try `poe-code skill configure claude` and get an error or unexpected behavior. The two agent lists being out of sync makes it unclear which commands apply to which agents.

## Suggested direction

Either derive both lists from the same source of truth, or explicitly document in `skill configure --help` which agents do not support skill directories and why.

## Severity

Medium

## Area

Skill / configure / agent list / consistency
