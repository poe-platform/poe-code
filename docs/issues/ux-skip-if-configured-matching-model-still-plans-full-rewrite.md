---
severity: high
impact: correctness
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
