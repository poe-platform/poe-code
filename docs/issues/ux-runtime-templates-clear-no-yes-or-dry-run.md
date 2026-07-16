---
severity: high
impact: correctness
reproduced: y
recommendation: fix
evidence: "src/cli/commands/runtime/templates/clear.ts:47-66 runs the dsConfirm prompt before the flags.dryRun branch, so --dry-run still prompts (fails non-TTY); dry-run message reports only a count, never lists entries; `npm run dev -- runtime templates clear --help` prints only -h, though global -y/--yes and --dry-run exist at src/cli/program.ts:852-853 and flags.assumeYes is honored"
comment: "Keep as canonical of this pair and the more serious half: templates clear deletes cached entries (21 in the sibling's evidence) with no --dry-run to preview and no documented --yes, and --dry-run itself fails with the POE_NO_PROMPT error - so the safe-preview path is unreachable. That combination is worse than either flag being absent alone. Its fix is right: --yes plus a --dry-run that lists entries."
---

# UX: runtime templates clear has no --yes/--dry-run; demands POE_NO_PROMPT

## Summary

runtime templates clear --help only -h; non-TTY requires POE_NO_PROMPT; no dry-run of what will be deleted (many e2b templates exist).

## Evidence

```bash
$ poe-code runtime templates clear --dry-run
■  Error: Interactive prompt requires a TTY. Set POE_NO_PROMPT=1 …
```

## Why it matters

Destructive cache clear is hard to use safely in CI.

## Suggested direction

Add --yes, --dry-run listing entries; honor --yes without POE_NO_PROMPT.

## Severity

**High**

## Area

Runtime
