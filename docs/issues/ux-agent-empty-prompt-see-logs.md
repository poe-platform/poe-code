---
severity: medium
impact: usability
comment: "The message itself is already correct; only the 'See logs' tease is wrong. So this carries no independent design decision - it is the systemic UserError-classification issue (ux-user-errors-look-like-system-failures.md) observed on 'agent \"\"'. Keep as one instance, fix centrally."
reproduced: y
recommendation: fix
evidence: "packages/poe-agent/src/agent-session.ts:191 throws plain Error('Prompt must not be empty.'); src/cli/bootstrap.ts:71-80 only omits the 'See logs at .../errors.log' line for CliError with isUserError, so this non-CliError takes the system-failure branch; src/cli/commands/agent.ts:53 passes the prompt straight to sendMessage with no ValidationError check"
---

# UX: agent empty prompt has See logs on ValidationError

## Summary

agent "" → Prompt must not be empty + See logs — message good, chrome wrong.

## Evidence

```bash
$ poe-code agent ""
■  Error: Prompt must not be empty.
●  See logs …
```

## Why it matters

User validation should not suggest logs.

## Suggested direction

UserError without See logs.

## Severity

Medium

## Area

Agent
