---
severity: high
impact: usability
reproduced: y
recommendation: fix
evidence: "src/cli/isolated-env.ts:131 (and :274) throw plain Error 'Cannot resolve \"providerCredential\": no active provider on context.'; src/cli/bootstrap.ts:71-81 prints non-CliError as 'Error: <msg>' plus 'See logs at .../errors.log', matching the reported output."
comment: "Keep as canonical of the gemini credential trio for the error-copy half: 'Cannot resolve providerCredential: no active provider on context' is internal resolution jargon presented as a crash, and its suggested replacement is right. But the copy fix is secondary to the question its sibling raises (whether gemini can use poe credentials at all) - answer that before rewording, since the correct message depends on the answer."
---

# UX: spawn gemini fails with opaque "no active provider on context"

## Summary

spawn gemini with an explicit model can fail with Cannot resolve "providerCredential": no active provider on context — internal jargon without telling the user to configure gemini or login to a compatible provider.

## Evidence

```bash
$ poe-code spawn gemini "say only: ok" --mode read --model google/gemini-2.5-pro
■  Error: Cannot resolve "providerCredential": no active provider on context.
●  See logs …
```

## Why it matters

Looks like an internal crash; recovery is configure/login, not reading errors.log.

## Suggested direction

UserError: Gemini is not configured. Run poe-code configure gemini or pass provider credentials; map providerCredential errors.

## Severity

**High**

## Area

Spawn / gemini
