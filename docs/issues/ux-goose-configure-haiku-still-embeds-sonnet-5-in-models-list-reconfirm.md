# UX: configure goose with haiku still embeds sonnet-5 in models list (reconfirm)

## Summary

configure goose --model anthropic/claude-haiku-4.5 --yes --dry-run still embeds anthropic/claude-sonnet-5 in models list while GOOSE_MODEL becomes haiku — Critical goose sonnet-5 list still open.

## Evidence

```bash
$ poe-code configure goose --model anthropic/claude-haiku-4.5 --yes --dry-run
◇  Goose default model → anthropic/claude-haiku-4.5
# dry-run still includes:
+      "name": "anthropic/claude-sonnet-5",
+GOOSE_MODEL: anthropic/claude-haiku-4.5
```

## Why it matters

Reconfirm Critical goose models list still ships dead sonnet-5.

## Suggested direction

Remove sonnet-5 from goose maps; use sonnet-4.6; CI catalog check.

## Severity

**High**

## Area

Config / models
