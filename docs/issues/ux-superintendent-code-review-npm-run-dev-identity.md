---
severity: medium
impact: discoverability
comment: "Duplicate within the identity cluster; retire into ux-development-mode-usage-intentional-but-leaks.md. Its one useful contribution is scoping: superintendent and code-review share the behavior, supporting the theory that all toolcraft-hosted groups inherit it from one place."
---

# UX: superintendent and code-review help still npm run dev

## Summary

superintendent and code-review Usage: npm run dev -- … — identity leak class.

## Evidence

Usage: npm run dev -- superintendent [command]
Usage: npm run dev -- code-review [command]

## Why it matters

Reconfirm displayBinaryName.

## Suggested direction

poe-code in Usage.

## Severity

Medium

## Area

Help / identity
