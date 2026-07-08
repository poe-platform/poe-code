# UX: runtime templates clear has no --yes/--dry-run; demands POE_NO_PROMPT

## Summary

runtime templates clear --help only -h; non-TTY requires POE_NO_PROMPT; no dry-run of what will be deleted (many e2b templates exist).

## Evidence

```bash
$ poe-code runtime templates clear --dry-run
■  Error: Interactive prompt requires a TTY. Set POE_NO_PROMPT=1 …
```

## Why it matters

Destructive cache clear is hard to use safely in CI.

## Suggested direction

Add --yes, --dry-run listing entries; honor --yes without POE_NO_PROMPT.

## Severity

**High**

## Area

Runtime
