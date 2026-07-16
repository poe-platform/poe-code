---
severity: high
impact: usability
comment: "Instance of the POE_NO_PROMPT-versus---yes family; retire into ux-non-tty-prompt-wrong-guidance.md. Its own question is worth keeping and is sharper than the family's usual complaint: --type host|docker|e2b already supplies the only value the prompt would ask for, so it is unclear why it prompts at all - that may be a genuine bug rather than a message problem. Verify before merging. VERIFIED: the sharper hypothesis is disproven - --type and --yes both bypass the prompt correctly (shared.ts:32-38, confirmed by CLI probe), and --dry-run does exist, so the body's 'still prompts?', 'CI cannot init with --yes' and 'no --dry-run' claims are all wrong. What survives is exactly the family complaint: the generic non-TTY error advertises POE_NO_PROMPT=1 instead of the --yes that works, and neither is listed in runtime init --help. Safe to retire into the family doc; no runtime-specific bug."
reproduced: y
recommendation: fix
evidence: "packages/toolcraft-design/src/prompts/interactive/core.ts:133 rejects non-TTY with 'Set POE_NO_PROMPT=1'; probe: npm run dev -- runtime init --dry-run errors, while --type host and --yes both succeed (src/cli/commands/runtime/shared.ts:32-38); runtime init --help lists neither --yes nor POE_NO_PROMPT, and offers only host/docker (no e2b)"
---

# UX: runtime init non-TTY demands POE_NO_PROMPT not --yes

## Summary

runtime init without TTY says Interactive prompt requires a TTY. Set POE_NO_PROMPT=1 — obscure env vs standard --yes used elsewhere; no --dry-run.

## Evidence

```bash
$ poe-code runtime init --dry-run
■  Error: Interactive prompt requires a TTY. Set POE_NO_PROMPT=1 to accept defaults non-interactively.
```
Help has --type host|docker|e2b but still prompts?

## Why it matters

CI cannot init runtime with --yes; POE_NO_PROMPT is undocumented on help.

## Suggested direction

Honor --yes/--type without TTY; document POE_NO_PROMPT or remove it.

## Severity

**High**

## Area

Runtime / non-TTY
