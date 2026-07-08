# UX: approvals list --state bogus still silent empty (reconfirmed)

## Summary

approvals list --state bogus returns No approvals found without invalid-state error — reconfirm.

## Evidence

```bash
$ poe-code approvals list --state bogus
No approvals found.
```

## Why it matters

Invalid filter looks empty.

## Suggested direction

Validate state enum.

## Severity

Medium

## Area

Approvals
