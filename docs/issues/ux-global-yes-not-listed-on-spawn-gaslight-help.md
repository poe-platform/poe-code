# UX: global --yes not listed on spawn/gaslight command help (reconfirmed via files)

## Summary

spawn help only mentions --yes in mode description (--yes uses yolo); gaslight help has no --yes at all though root has -y/--yes. Users may not know global flags apply.

## Evidence

spawn: (prompted; --yes uses yolo) only
gaslight Options: no --yes
root: -y, --yes Accept defaults

## Why it matters

Global options should appear on command help or be clearly inherited.

## Suggested direction

List global options on subcommand help footers.

## Severity

**High**

## Area

Help
