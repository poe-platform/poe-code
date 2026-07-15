---
severity: low-medium
impact: discoverability
comment: "Instance of the global-flags-not-listed family; retire into ux-global-flags-hidden-on-subcommand-help.md. It does note the oddity that update documents three local flags and omits the global one that matters most for a command that mutates the installation - a good argument for rendering global flags on every subcommand rather than curating per command."
---

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
