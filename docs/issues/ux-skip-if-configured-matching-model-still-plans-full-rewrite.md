---
severity: high
impact: none
reproduced: n
recommendation: no-fix
evidence: "configure.ts:149-157 sets skippedConfigured and returns before any writes when hasMaterialConfigureChange (configure.ts:289-325 overlay byte-compare) is false, with no flags.dryRun branch; configure.ts:268-274 emits 'Dry run: <label> is already configured.'; vitest configure.test.ts -t skip-if-configured: 1 passed. Doc's own evidence passes anthropic/claude-sonnet-4.6 against live claude-sonnet-4-6, a real byte difference, so a full plan is expected and the 'model matches' premise fails."
comment: "Duplicate within the skip-never-short-circuits quartet; retire into ux-skip-if-configured-help-text-lies.md. Its evidence is the tightest of the four (explicit model matching live config, still a full plan), which rules out the mismatch explanation - carry that into the canonical."
---

# UX: configure --skip-if-configured with matching model still plans full rewrite

## Summary

configure claude --model anthropic/claude-sonnet-4.6 --skip-if-configured --yes --dry-run still plans full settings create despite live config already sonnet-4.6 — skip never short-circuits dry-run (reconfirm class).

## Evidence

```bash
$ poe-code configure claude --model anthropic/claude-sonnet-4.6 --skip-if-configured --yes --dry-run
◇  Claude Code default model → anthropic/claude-sonnet-4.6
# full +settings.json create plan, not "would skip"
```
Live ~/.claude model is claude-sonnet-4-6.

## Why it matters

--skip-if-configured remains untrustworthy even when model matches.

## Suggested direction

Dry-run: would skip: already configured; never plan full rewrite on match.

## Severity

**High**

## Area

Configure
