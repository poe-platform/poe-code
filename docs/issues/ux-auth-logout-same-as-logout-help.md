---
severity: high
impact: discoverability
comment: "Real and under-appreciated - a naming/mental-model bug rather than a copy nit. Users read 'auth logout' as clearing credentials, but it is aliased to a full factory reset, so the command namespace misleads before any help text is read. Pairs with ux-logout-overclaims-scope.md (copy understates scope) and ux-auth-logout-no-confirmation-removes-all-agents.md (no gate). Answer the product question once: either auth logout becomes credentials-only and root logout stays the reset, or drop the alias - then align copy and gate."
---

# UX: auth logout help identical to root logout (factory-reset copy)

## Summary

auth logout help says Remove all configuration and credentials same as root logout — if auth logout is alias of full factory reset, it is misnamed under auth group.

## Evidence

```text
auth logout: Remove all configuration and credentials.
logout: Remove all configuration and credentials.
```

## Why it matters

Users expect auth logout to only clear credentials, not unconfigure agents.

## Suggested direction

If full reset: rename/warn; if credentials-only: implement and document difference.

## Severity

**High**

## Area

Auth / destructive
