# UX: spawn poe-agent still crashes fs.lstat (2026-07-08 reconfirm)

## Summary

spawn poe-agent --yes with haiku still: fs.lstat is not a function + See logs — Critical #18 still open.

## Evidence

```bash
$ poe-code spawn poe-agent "say only: ok" --mode read --model anthropic/claude-haiku-4.5 --yes
■  Error: fs.lstat is not a function
●  See logs …
```

## Why it matters

Reconfirm Critical poe-agent crash still open.

## Suggested direction

Fix fs mock/import; UserError if agent broken.

## Severity

**High**

## Area

Spawn / poe-agent
