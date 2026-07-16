---
severity: low
impact: none
reproduced: n
recommendation: no-fix
evidence: "packages/agent-skill-config/src/bridge-active-skills.ts:128-156 builds the described message: 'Failed to bridge active skills ... could not be resolved.', 'Not found skill references.', per-ref '  searched paths:' list; behaviour is the documented positive, no defect"
comment: "Strong positive and the best not-found recovery in the product: it names the unresolved reference and lists every path searched, so the user can see exactly where to put the file. That is the shape the memory INDEX and harness discovery failures need (ux-memory-show-cannot-open-root-index-file.md, ux-harness-list-only-cwd-not-created-dir.md), where 'not found' is asserted without saying where the tool looked. Cite as the reference; its See logs residue is the systemic issue."
---

# UX: skill bridge failure lists searched paths (positive with chrome)

## Summary

Failed to bridge active skills lists Not found skill references and searched paths — good recovery content (still See logs + panel lifecycle).

## Evidence

```bash
$ poe-code spawn … --skill not-a-skill
■  Error: Failed to bridge active skills: 1 skill reference(s) could not be resolved.
│  Not found skill references.
│  - not-a-skill
│  searched paths:
│  - …/.poe-code/skills/not-a-skill
│  - ~/.poe-code/skills/not-a-skill
```

## Why it matters

Positive recovery detail pattern.

## Suggested direction

Keep paths; drop See logs; ValidationError.

## Severity

Low

## Area

Spawn / positive pattern
