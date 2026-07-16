---
severity: low
impact: none
comment: "Contentless duplicate of ux-login-yes-without-key-message-good.md; retire into it. It does state the key insight in one line - --yes fails fast while bare login hangs - which is the argument that makes the hang fix trivial: the good behavior already exists on the adjacent path."
reproduced: n
recommendation: no-fix
evidence: "src/cli/options.ts:155-158 throws the fail-fast no-API-key message when assumeYes; src/cli/options.ts:160 falls through to init.loginViaOAuth() without --yes. Behaviour confirmed, but this doc is a positive/duplicate note of ux-login-yes-without-key-message-good.md, not a defect."
---

# UX: login --yes good; bare hangs

## Summary

--yes fail-fast good; bare hangs.

## Evidence

login --yes.

## Why it matters

Align bare login.

## Suggested direction

Same fail-fast.

## Severity

Low

## Area

Auth
