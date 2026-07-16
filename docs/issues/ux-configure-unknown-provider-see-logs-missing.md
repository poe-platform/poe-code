---
severity: low-medium
impact: usability
reproduced: y
recommendation: fix
evidence: "src/cli/commands/configure.ts:838 throws Unknown provider \"${explicit}\". with no allow-list, unlike precedent src/cli/commands/shared.ts:205 which appends 'Exposed shapes: ...'; no 'See logs' chrome in that path."
comment: "The only member of the Unknown-provider quartet with an actionable ask (list the valid providers), so keep this and retire the two positives into it. The precedent for the fix exists in the same command - ux-configure-unknown-api-shape-lists-exposed.md lists exposed shapes on error - making this an inconsistency to close rather than a feature to design. Note the title is misleading: there is no 'See logs' problem here."
---

# UX: configure unknown provider is clear but no recovery list

## Summary

configure --provider bogus: Unknown provider "bogus" — clear; should list available providers (poe, anthropic, openai, cloudflare).

## Evidence

■  Error: Unknown provider "bogus".

## Why it matters

Good ValidationError; add allow-list.

## Suggested direction

Unknown provider "bogus". Expected: poe, anthropic, openai, cloudflare.

## Severity

Low–Medium

## Area

Configure
