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
