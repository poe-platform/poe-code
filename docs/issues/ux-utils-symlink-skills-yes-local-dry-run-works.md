---
severity: low
impact: none
reproduced: n
recommendation: no-fix
evidence: "Positive note, no defect: probe `npm run dev -- utils symlink skills --yes --local --dry-run` printed 'rename .claude/skills -> .agents/skills' then 'symlink .claude/skills -> ../.agents/skills' and changed nothing on disk; src/cli/commands/utils-symlink-ops.ts:47-62 logs both ops and skips writes when dryRun. The --yes gating residue lives in utils-symlink-skills.ts:64-73 and is tracked by ux-utils-symlink-skills-scope-error-vs-agents.md."
comment: "Positive pattern and a genuinely good dry-run: it names both filesystem operations (rename then symlink) so the user can see exactly what would happen. Its own suggestion is the useful residue and pairs with ux-utils-symlink-skills-scope-error-vs-agents.md: a dry-run should not require --yes, since previewing is the safe operation. A small real inconsistency - --yes gating a command that changes nothing."
---

# UX: utils symlink skills --yes --local --dry-run works (positive after scope flags)

## Summary

With explicit scope flags, dry-run shows rename+symlink plan — positive once scope is provided (still subject to earlier non-TTY scope friction).

## Evidence

```bash
$ poe-code utils symlink skills --yes --local --dry-run
●  rename .claude/skills -> .agents/skills
●  symlink .claude/skills -> ../.agents/skills
```

## Why it matters

Documents working path; keep with scope-error issue.

## Suggested direction

Allow dry-run without --yes by assuming local default with note.

## Severity

Low

## Area

Utils / positive pattern
