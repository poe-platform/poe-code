---
severity: low-medium
impact: usability
reproduced: y
recommendation: no-fix
evidence: "src/cli/commands/memory.ts:526 throws plain Error, so src/cli/bootstrap.ts:71-79 adds 'Error:' prefix plus 'See logs at ...' chrome; confirmed by `npm run dev -- memory cache clear` output"
comment: "Duplicate within the cache clear trio; retire into ux-memory-cache-clear-requires-yes-good.md. Its only content is the 'See logs' chrome on a refusal, which belongs to ux-user-errors-look-like-system-failures.md - with the mild irony that a correct safety refusal is dressed as a system failure."
---

# UX: memory cache clear requires --yes but See logs on refuse

## Summary

memory cache clear without --yes: Refusing to clear cache without --yes + See logs — good policy, system chrome.

## Evidence

■  Error: Refusing to clear cache without --yes.
●  See logs …

## Why it matters

UserError without logs; document --yes on help.

## Suggested direction

UserError; add --yes to help.

## Severity

Low–Medium

## Area

Memory
