# UX: unknown --shape-base-url shape lists exposed shapes (positive)

## Summary

Unknown API shape "messages" lists Exposed shapes: openai-chat-completions, openai-responses, anthropic-messages — good recovery (user used messages not anthropic-messages).

## Evidence

```bash
$ poe-code configure claude --shape-base-url "messages=https://example.com" --yes --dry-run
■  Error: Unknown API shape "messages" for provider "poe". Exposed shapes: …
```

## Why it matters

Positive allow-list; could suggest closest match anthropic-messages.

## Suggested direction

Keep; add Did you mean anthropic-messages.

## Severity

Low

## Area

Configure / positive pattern
