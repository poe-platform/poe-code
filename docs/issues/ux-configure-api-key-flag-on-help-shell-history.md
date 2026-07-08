# UX: configure --help advertises --api-key (shell history risk)

## Summary

configure --help lists --api-key <key> Poe API key — encourages shell history leaks (same class as agent/login --api-key).

## Evidence

--api-key <key>  Poe API key

## Why it matters

Reconfirm API key flags on help encourage history leaks.

## Suggested direction

Prefer env/login; warn if flag used; document POE_API_KEY.

## Severity

Medium

## Area

Configure / security
