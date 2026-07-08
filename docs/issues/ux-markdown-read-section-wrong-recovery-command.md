# UX: markdown-read-section miss suggests read-markdown not markdown-read

## Summary

markdown-read-section no-such-section: try read-markdown to see TOC — wrong command name (actual is plan markdown-read).

## Evidence

no section matching "no-such-section" (try 'read-markdown' to see the table of contents)
●  See logs …

## Why it matters

Wrong recovery command; See logs on ValidationError.

## Suggested direction

suggest: poe-code plan markdown-read <file>; UserError.

## Severity

**High**

## Area

Plan
