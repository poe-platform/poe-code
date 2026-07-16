---
severity: high
impact: usability
reproduced: y
recommendation: fix
evidence: "Probe 'npm run dev -- test </dev/null' prints '■ Error: Interactive prompt requires a TTY. Set POE_NO_PROMPT=1 to accept defaults non-interactively.' plus '● See logs at ~/.poe-code/logs/errors.log'; message from packages/toolcraft-design/src/prompts/interactive/core.ts:133, while src/cli/commands/configure.ts:1024-1027 resolveServiceArgument does honor flags.assumeYes and never lists agents."
comment: "Instance of the POE_NO_PROMPT-versus---yes family; retire into ux-non-tty-prompt-wrong-guidance.md. Its extra ask is worth carrying: list the available agents rather than merely demanding a prompt mode - the capability matrix would supply that content."
---

# UX: bare test non-TTY demands POE_NO_PROMPT not --yes

## Summary

test without agent non-TTY: Interactive prompt requires a TTY. Set POE_NO_PROMPT=1 to accept defaults non-interactively + See logs — should honor --yes; POE_NO_PROMPT is obscure.

## Evidence

```bash
$ poe-code test
■  Interactive prompt requires a TTY. Set POE_NO_PROMPT=1 …
●  See logs …
```

## Why it matters

Non-TTY fail-fast should use --yes; POE_NO_PROMPT is wrong primary guidance.

## Suggested direction

Honor --yes; list agents or default; UserError without logs.

## Severity

**High**

## Area

Test / non-TTY
