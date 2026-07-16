---
severity: low
impact: none
reproduced: n
recommendation: no-fix
evidence: "npm run dev -- generate image --help outputs 'Unknown command: generate'; rg finds no 'nano-banana' or 'generate' command in src/ or packages/"
comment: "Two fair, small points, correctly Low. The '(default: [])' noise is trivial. The opaque model name is more interesting and its suggested direction is the right instinct: rather than explaining 'google/nano-banana-pro' in help, point at models --output image so the answer stays correct as the catalog changes - the same 'derive, do not hard-code' principle as ux-agent-default-model-hardcoded.md."
---

# UX: generate image --help shows opaque internal model ID as default

## Summary

`poe-code generate image --help` shows:

```
Options:
  --model <model>       Model identifier (default: google/nano-banana-pro)
  --param <key=value>   Additional parameters (repeatable) (default: [])
```

Two issues:

1. **`google/nano-banana-pro` is an internal identifier** — users cannot recognize this as a real model. The name "nano-banana-pro" is not a publicly documented model name. Users cannot verify what this model is or whether it is still current.

2. **`(default: [])` is useless** — showing an empty array as the default for `--param` is an implementation detail with no user value. It just adds noise.

## Why it matters

Users evaluating image generation need to know what model they're getting by default — whether it's capable enough for their use case and what alternatives exist. An opaque internal name provides no signal.

An empty array default adds clutter to the help without teaching the user anything.

## Suggested direction

- Replace `google/nano-banana-pro` with either a recognizable public name or a note like "default image model; use `poe-code models --output image` to see alternatives"
- Remove `(default: [])` from `--param` — an empty default needs no annotation

## Severity

Low

## Area

Generate / image / help / default values / discoverability
