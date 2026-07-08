# UX: gh install previews with "would be written" but --dry-run not in help

## Summary

gh install fix-vulnerabilities (with --dry-run passed) showed would be written paths and eject tip — preview language good; help only --eject, no --dry-run; npm run dev identity.

## Evidence

install help: [name], --eject. Output uses would be written language.

## Why it matters

Document whether default is preview or write; add --yes for write.

## Suggested direction

Explicit --dry-run/--yes; displayBinaryName.

## Severity

Medium

## Area

GitHub workflows
