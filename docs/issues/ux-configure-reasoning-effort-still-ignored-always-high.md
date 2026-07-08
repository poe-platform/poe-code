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
