# UX: skip-if-configured with matching sonnet-4.6 still full rewrite (reconfirm)

## Summary

configure claude --model anthropic/claude-sonnet-4.6 --skip-if-configured --yes --dry-run still plans full settings create despite live model match — Critical skip class still open.

## Evidence

◇  Claude Code default model → anthropic/claude-sonnet-4.6
# full +settings.json create plan, not would skip

## Why it matters

Reconfirm --skip-if-configured still untrustworthy when model matches.

## Suggested direction

Dry-run: would skip: already configured.

## Severity

**High**

## Area

Configure
