# UX: Empty plan kind filters still draw empty table chrome

## Summary

plan list --kind experiment|ralph|superintendent draws full empty table borders with no "No plans" message (extends empty plan list issue across kinds).

## Evidence

plan list --kind experiment → empty table frame only.

## Why it matters

Looks like a rendering bug for empty filters.

## Suggested direction

No-plans message + create/install hints per kind.

## Severity

Medium

## Area

Plan list
