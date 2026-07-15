---
severity: high
impact: correctness
comment: "Pair with ux-configure-base-url-not-visible-in-dry-run.md: same observation, two incompatible hypotheses - 'the flag is ignored' versus 'the flag applies but dry-run does not show it'. That unresolved ambiguity is the blocker and neither file settles it. Do not schedule until someone runs configure without --dry-run and inspects the written settings; the answer decides whether this is a correctness bug (High justified) or a dry-run fidelity bug (lower). Merge into one issue with that question stated up front."
---

# UX: configure --base-url may not apply to planned ANTHROPIC_BASE_URL

## Summary

configure claude --base-url https://example.com --yes --dry-run still shows ANTHROPIC_BASE_URL api.poe.com in diff — flag may be ignored or only applies to non-poe providers.

## Evidence

```bash
$ poe-code configure claude --base-url "https://example.com" --yes --dry-run
# still +"ANTHROPIC_BASE_URL": "https://api.poe.com"
```

## Why it matters

Silent ignore of --base-url is a footgun for gateway users.

## Suggested direction

Apply --base-url to planned env; or error if incompatible with provider.

## Severity

**High**

## Area

Configure
