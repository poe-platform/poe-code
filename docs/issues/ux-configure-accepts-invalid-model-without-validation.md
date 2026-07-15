---
severity: high
impact: correctness
comment: "Duplicate of ux-configure-accepts-any-string-as-model-no-catalog-check.md; retire into it, carrying over its two better-specified fix details which the canonical lacks: behave sensibly offline (warn rather than block) and point at 'models --search' in the refusal. Its High rating conflicts with the twin's Critical; normalise."
---

# UX: configure --model accepts inventable invalid model ids

## Summary

configure --model totally-fake-model-xyz --yes --dry-run proceeds to plan writes without validating the model exists in the Poe catalog.

## Evidence

```bash
$ poe-code configure claude --model totally-fake-model-xyz --yes --dry-run
●  Dry run: would configure Claude Code.
# no "unknown model" error
```

## Why it matters

Users can lock in typos and only discover at runtime (400 unsupported model).

## Suggested direction

Validate model against catalog when online; warn offline; refuse unknown ids with models --search hint.

## Severity

**High**

## Area

Configure / models
