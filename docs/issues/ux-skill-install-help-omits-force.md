---
severity: high
impact: usability
reproduced: y
recommendation: no-fix
evidence: "src/cli/commands/skill.ts:88-95 install declares --name/--file/-y/--local/--global with no --force (skill.ts:296 --force exists only on unconfigure), while src/cli/commands/experiment.ts:1106 and src/cli/commands/pipeline.ts:1397 install both declare '--force'. Divergence is real but fully covered by umbrella ux-install-skill-flags-inconsistent-across-commands.md (reproduced=y, recommendation=fix), so this narrower filing is a duplicate."
comment: "Member of the installer-flags inconsistency family; retire into ux-install-skill-flags-inconsistent-across-commands.md, which documents all five contracts. Its own framing understates the problem: this is not just a help omission but another divergence - experiment and pipeline have --force while skill, memory and plan do not."
---

# UX: skill install --help omits --force

## Summary

skill install help has name/file/yes/local/global only — no --force while experiment install has --force; overwrite policy unclear.

## Evidence

skill install Options: --name, --file, -y, --local, --global, -h

## Why it matters

Reconfirm unified skill-install force policy.

## Suggested direction

Add --force; document overwrite.

## Severity

**High**

## Area

Skills
