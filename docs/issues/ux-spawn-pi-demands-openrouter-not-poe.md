---
severity: high
impact: usability
comment: "Strong filing and worse than it looks: spawn pi fails demanding an openrouter key and points users at pi-coding-agent's own docs inside node_modules, so poe-code advertises an agent it has not wired to Poe auth and hands the user a foreign recovery path (/login for a different tool). A capability gap dressed as an error. Note the tension with ux-spawn-pi-yes-works.md, which reports spawn pi succeeding - resolve whether pi works only when it finds an unrelated openrouter key in the environment, which would make that positive misleading."
---

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
