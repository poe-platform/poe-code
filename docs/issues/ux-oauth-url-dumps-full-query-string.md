---
severity: low-medium
impact: polish
comment: "Contentless and the weakest kind of filing: a long authorize URL is inherent to OAuth and must be complete to be usable, so 'hard to copy' is not obviously fixable. Needs the actual output before anyone can judge whether framing would help. Low value; close unless a concrete rendering problem is shown."
reproduced: y
recommendation: no-fix
evidence: "src/cli/oauth-login.ts:60 logs the full authorizationUrl inline; packages/poe-oauth/src/oauth-client.ts:113-125 builds it with 7 required params (response_type, client_id, scope, code_challenge, code_challenge_method, redirect_uri, state), so the long line exists but every param is mandatory and browser auto-open plus paste-fallback already cover the copy path"
---

# UX: OAuth URL full query dump

## Summary

Long authorize URL line.

## Evidence

login OAuth.

## Why it matters

Hard copy.

## Suggested direction

Clean URL block.

## Severity

Low–Medium

## Area

Auth polish
