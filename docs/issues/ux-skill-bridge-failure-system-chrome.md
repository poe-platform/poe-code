---
severity: medium
impact: usability
comment: "Contentless twin of ux-skill-bridge-failure-lists-paths-good.md; retire. Its four-word summary is accurate ('Good content ... system chrome') and is the whole systemic UserError issue in miniature - the content is right, the classification is wrong."
reproduced: y
recommendation: no-fix
evidence: "bridge-active-skills.ts:158 returns plain Error, so bootstrap.ts:72-78 adds 'Error:' prefix plus 'See logs at ...' chrome; duplicate of ux-skill-bridge-failure-lists-paths-good.md"
---

# UX: --skill good text system chrome

## Summary

Paths listed + See logs.

## Evidence

--skill missing.

## Why it matters

Good content.

## Suggested direction

ValidationError.

## Severity

Medium

## Area

Spawn / skills
