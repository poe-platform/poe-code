---
severity: high
impact: discoverability
comment: "Keep as canonical for unknown-agent messaging: the only filing that surveys all four commands at once and catches that even the punctuation differs ('Unknown agent \"x\"' versus 'Unknown agent: x'), itself evidence the message is implemented several times rather than shared. Its fix list is complete and correct, and two of its parts already exist in-product - the allow-list pattern (ux-hooks-from-unknown-lists-supported-good.md) and the suggester (ux-toolcraft-has-suggestions-poe-code-root-does-not.md). Its validate-agent-before-mode ask belongs with ux-spawn-validates-mode-before-agent-reconfirmed.md."
---

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
