# UX: agent --help advertises --api-key (shell history risk)

## Summary

agent --help lists --api-key <key> — encourages passing secrets on CLI (history/process list leak class).

## Evidence

Options: --api-key <key> Poe API key

## Why it matters

Reconfirm API key flags encourage shell history leaks.

## Suggested direction

Prefer env/login; warn if flag used; document POE_API_KEY.

## Severity

Medium

## Area

Agent / security
