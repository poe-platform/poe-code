---
severity: critical
impact: correctness
reproduced: y
recommendation: fix
evidence: "src/cli/commands/configure-payload.ts:108 gates reasoningEffort on adapter.configurePrompts?.reasoningEffort; only src/providers/codex.ts declares it, so src/providers/claude-code.ts ignores the flag entirely, and rg for 'effortLevel' across src/ and packages/ returns zero hits, so planned high is echoed existing settings"
comment: "Best filing in the effort cluster and the right canonical: it sweeps every value (low..max), proves the flag is a complete no-op, and lands the key insight that the written value tracks the live settings file rather than the flag - reframing the bug from 'wrong constant' to 'the flag never reaches the write and existing settings are echoed back'. That also explains why an earlier session saw always-xhigh and this one always-high. Correctly Critical. Absorbs ux-configure-reasoning-effort-ignored-for-claude.md, ux-configure-claude-ignores-reasoning-effort-always-xhigh.md and ux-configure-haiku-still-plans-effortlevel-xhigh.md. Cross-check the misattribution artefact in ux-configure-dry-run-shows-full-existing-settings-as-create.md first, since some of what looks written may be echoed existing state."
---

# UX: configure --reasoning-effort still ignored; always plans effortLevel high

## Summary

configure claude --model anthropic/claude-sonnet-4.6 --reasoning-effort low|medium|high|xhigh|max --yes --dry-run all plan effortLevel: "high". Flag completely ignored. Earlier session saw always xhigh; after live settings effort restored to high, dry-run always high — likely merging/writing from existing settings or fixed default, never from flag. Opus --reasoning-effort xhigh also plans high not xhigh.

## Evidence

```bash
for e in low medium high xhigh max; do
  poe-code configure claude --model anthropic/claude-sonnet-4.6 --reasoning-effort $e --yes --dry-run
  # always: + "effortLevel": "high"
done
$ poe-code configure claude --model anthropic/claude-opus-4.7 --reasoning-effort xhigh --yes --dry-run
# + "effortLevel": "high"  (not xhigh; opus catalog supports xhigh)
```
Live settings effortLevel was high after audit restore.

## Why it matters

--reasoning-effort is a no-op; users cannot set effort. Related Critical always-xhigh evolved to always-high.

## Suggested direction

Honor flag; model-aware allow-list; default from catalog; show effective effort in intentional dry-run.

## Severity

**Critical**

## Area

Configure / models
