# UX: models --search "novita ai/kimi-k2.5" returns 0

## Summary

Catalog displays novita ai/kimi-k2.5 but --search "novita ai/kimi-k2.5" returns 0 — space in provider display name breaks exact paste search; constants use novitaai/ without space.

## Evidence

--search "novita ai/kimi-k2.5" → 0; --search kimi-k2.5 → 1; constants novitaai/kimi-k2.5

## Why it matters

Display id and search id diverge; constants use third form.

## Suggested direction

Normalize provider ids; document search tokens; align constants.

## Severity

**High**

## Area

Models / config
