# UX: code-review drafts missing prUrl double error + npm run dev

## Summary

code-review drafts without prUrl: missing required argument prUrl twice + npm run dev recovery — same class as code-review run.

## Evidence

error: missing required argument 'prUrl'
■  error: missing required argument 'prUrl'
Run npm run dev -- code-review drafts --help

## Why it matters

Double error + identity leak.

## Suggested direction

Single ValidationError; poe-code recovery.

## Severity

Medium

## Area

Code-review / identity
