---
severity: high
impact: capability-gap
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
