# UX: update --help omits global --dry-run

## Summary

update help lists --force, --no-version-check, --package-manager but not --dry-run though dry-run works via global option.

## Evidence

update --help has no --dry-run line; update --dry-run works.

## Why it matters

Discoverability of safe preview for update.

## Suggested direction

Document global --dry-run on update help or add local flag.

## Severity

Low–Medium

## Area

Update
