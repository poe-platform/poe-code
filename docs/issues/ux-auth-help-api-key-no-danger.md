# UX: auth help lists api-key without danger note

## Summary

auth --help lists api-key Display stored API key with no danger/secret warning at group level.

## Evidence

api-key  Display stored API key.

## Why it matters

Group help should warn secret reveal.

## Suggested direction

Display stored API key (sensitive; prefer mask).

## Severity

Medium

## Area

Auth
