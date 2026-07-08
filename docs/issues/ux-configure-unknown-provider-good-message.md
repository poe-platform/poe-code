# UX: configure unknown provider message is good (positive)

## Summary

configure --provider notaprovider returns Unknown provider "notaprovider" cleanly (could still list known providers).

## Evidence

```bash
$ poe-code configure claude --provider notaprovider --yes --dry-run
■  Error: Unknown provider "notaprovider".
```

## Why it matters

Good base message; recovery list would improve.

## Suggested direction

Append Known: poe, openai, cloudflare, …

## Severity

Low

## Area

Configure / positive pattern
