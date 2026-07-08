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
