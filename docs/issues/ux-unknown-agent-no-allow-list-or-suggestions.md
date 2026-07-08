# UX: Unknown agent errors omit allow-list and suggestions

## Summary

install/test/configure/unconfigure unknown agent say Unknown agent "notanagent" (+ See logs) without listing valid agents or Did you mean. skill configure says Unknown agent: notanagent (different punctuation). spawn validates --mode before agent.

## Evidence

```bash
$ poe-code install notanagent
■  Error: Unknown agent "notanagent".
●  See logs …
$ poe-code skill configure notanagent
■  Unknown agent: notanagent
$ poe-code spawn notanagent "hi"
# mode error first, then if mode set, unknown agent
```

## Why it matters

First-touch agent typos unrecoverable without reading --help.

## Suggested direction

List allowed agents; suggest closest; consistent ValidationError without logs; validate agent before mode.

## Severity

**High**

## Area

Agents
