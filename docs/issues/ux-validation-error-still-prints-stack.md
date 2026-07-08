# UX: Some ValidationErrors still print stacks

## Summary

ValidationError paths dump stack + double-render.

## Evidence

models --since bad → stack + message twice.

## Why it matters

Undoes ValidationError point.

## Suggested direction

No stacks for isUserError.

## Severity

**High**

## Area

Errors
