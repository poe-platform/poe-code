# UX: configure unknown API shape lists exposed shapes (positive)

## Summary

configure --shape-base-url messages=… → Unknown API shape "messages" for provider poe. Exposed shapes: openai-chat-completions, openai-responses, anthropic-messages.

## Evidence

Unknown API shape "messages" … Exposed shapes: …

## Why it matters

Positive shape validation with allow-list.

## Suggested direction

Keep; use anthropic-messages in examples.

## Severity

Low

## Area

Configure / positive pattern
