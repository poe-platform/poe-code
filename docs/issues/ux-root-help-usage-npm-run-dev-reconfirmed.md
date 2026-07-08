# UX: root --help Usage still npm run dev (reconfirmed)

## Summary

root --help: Usage: npm run dev -- <command> [...args] — displayBinaryName leak still open; hides half of commands separately Critical.

## Evidence

Usage: npm run dev -- <command> [...args]

## Why it matters

Reconfirm identity leak on root help.

## Suggested direction

Usage: poe-code <command> [...args]

## Severity

**High**

## Area

Help / identity
