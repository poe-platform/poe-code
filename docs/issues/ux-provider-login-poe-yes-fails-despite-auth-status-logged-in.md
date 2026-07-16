---
severity: high
impact: correctness
comment: "Important and correctly High: auth status reports logged in while provider login poe --yes says 'No API key found', so two credential stores disagree about the same account and neither explains itself. Users cannot tell which one governs a given command, which makes every auth-related failure ambiguous - plausibly including ux-auth-status-became-not-logged-in-mid-session.md, where credentials appeared to vanish. Its fix is right: unify resolution, or if the split is intentional, say so in both surfaces."
reproduced: y
recommendation: fix
evidence: "src/cli/commands/provider.ts:440 passes allowStored:false to resolveApiKey, so poe (preferredLogin oauth, packages/providers/src/providers/poe.ts:18) hits registry.ts:110 then src/cli/options.ts:147-157 throws 'No API key found' with --yes, while auth status reads the stored key via src/cli/commands/auth.ts:120 readApiKey."
---

# UX: provider login poe --yes fails despite auth status showing logged in

## Summary

auth status reports Logged in as … but provider login poe --yes says No API key found and points to --api-key / interactive login, implying two separate credential systems without explanation.

## Evidence

```bash
$ poe-code auth status
◆  Logged in as …
$ poe-code provider login poe --yes
■  Error: No API key found. Pass --api-key…
```

## Why it matters

Users think they are logged in; provider path disagrees. Confusing dual auth stores.

## Suggested direction

Unify credential resolution; if auth-store has key, provider login poe should reuse it; explain difference if intentional.

## Severity

**High**

## Area

Auth / providers
