# UX: auth api-key prints the full secret to the terminal

## Summary

poe-code auth api-key writes the complete Poe API key to stdout with no masking, confirmation, or design-system framing.

## Evidence

```bash
$ poe-code auth api-key
sk-poe-<full-secret>
```

## Why it matters

API keys are credentials; scrollback/screenshots/CI capture stdout.

## Suggested direction

Default masked output; require explicit --reveal for full key.

## Severity

**Critical**

## Area

Auth / security
