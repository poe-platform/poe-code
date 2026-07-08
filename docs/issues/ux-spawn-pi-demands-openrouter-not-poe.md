# UX: spawn pi fails No API key for openrouter (not Poe)

## Summary

spawn pi with haiku --yes: Pi spawn failed — No API key found for openrouter; points at earendil-works pi-coding-agent docs under nvm path — not Poe credential path; identity leak to pi package path.

## Evidence

```bash
$ poe-code spawn pi "say only: ok" --mode read --model anthropic/claude-haiku-4.5 --yes
■  Pi spawn failed … No API key found for openrouter.
Use /login … See: …/node_modules/@earendil-works/pi-coding-agent/docs/…
```

## Why it matters

Advertised spawn pi not wired to Poe auth; recovery is foreign /login.

## Suggested direction

Inject Poe OpenAI-compatible key for pi; UserError: run poe-code login.

## Severity

**High**

## Area

Spawn / pi
