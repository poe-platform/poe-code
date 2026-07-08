# UX: spawn validates mode before agent (reconfirmed)

## Summary

spawn unknown-agent --mode foobar fails mode first; spawn unknown-agent --mode read fails Unknown agent with See logs — mode-before-agent order reconfirmed; agent error still system chrome.

## Evidence

mode foobar → mode error; mode read + unknown agent → Unknown agent + See logs.

## Why it matters

Reconfirm validation order and agent error chrome.

## Suggested direction

Validate agent first or show both; UserError for unknown agent.

## Severity

Medium

## Area

Spawn
