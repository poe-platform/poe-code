# UX: plan view --output json dumps full markdown content

## Summary

plan view --output json includes entire content string of the plan body — huge payload for scripts that only need metadata.

## Evidence

JSON has kind, path, title, detail, content: full markdown…

## Why it matters

Metadata-only consumers pay full content cost; no --meta flag.

## Suggested direction

Default json without content; --include-content for body.

## Severity

Medium

## Area

Plan
