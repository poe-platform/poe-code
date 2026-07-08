# UX: --mcp-servers {} is accepted as no-op

## Summary

spawn with --mcp-servers {} succeeds without warning that no servers were configured — empty object is valid JSON but likely a mistake.

## Evidence

```bash
$ poe-code spawn … --mcp-servers '{}'
# succeeds
```

## Why it matters

Silent empty config footgun.

## Suggested direction

Warn if zero servers when flag present; or require at least one entry.

## Severity

Low–Medium

## Area

Spawn
