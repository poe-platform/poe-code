---
severity: low-medium
impact: usability
comment: "Duplicate within the eval empty-source cluster; retire into ux-eval-empty-source-message-inconsistent-skins.md. Its distinct angle is thin but fair - the error advertises --debug, a flag users have no other exposure to - which argues for dropping the tease rather than documenting it."
reproduced: y
recommendation: no-fix
evidence: "npm run dev -- eval report -C /tmp/empty-eval-probe prints 'does not contain any first-level <id>/eval.yaml files. Use --debug for a stack trace.' (packages/agent-eval/src/source/open.ts + packages/toolcraft/src/cli.ts:4144); --debug is registered hidden (packages/toolcraft/src/cli.ts:2918) and absent from root and 'eval report' help output"
---

# UX: eval report error mentions --debug but may be undocumented

## Summary

eval report with no eval folders says Use --debug for a stack trace while primary help may not surface --debug clearly for users.

## Evidence

```bash
$ poe-code eval report
■  … does not contain any first-level <id>/eval.yaml files. Use --debug for a stack trace.
```

## Why it matters

Error points to a flag users may not know; recovery should suggest eval init.

## Suggested direction

Suggest eval init; document --debug; design-system consistency.

## Severity

Low–Medium

## Area

Eval
