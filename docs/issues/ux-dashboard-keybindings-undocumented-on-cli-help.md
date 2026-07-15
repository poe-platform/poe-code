---
severity: medium
impact: discoverability
comment: "Distinct from the two 'dashboard missing' files and legitimate: q and Ctrl+C exist in the toolcraft-design keymap, but --tui help documents neither, so users cannot know graceful exit exists and may kill the process instead. Cheap with real value, and printing the legend on dashboard start beats help text because it appears where it is needed. Applies to every --tui surface (pipeline, experiment, ralph) - fix once."
---

# UX: Dashboard quit keybindings undocumented on pipeline/experiment/ralph help

## Summary

Live dashboards support q quit and Ctrl+C forceQuit but --tui help only says Show a live dashboard without keybinding legend.

## Evidence

toolcraft-design keymap: quit q, forceQuit Ctrl+C.
pipeline --help: --tui Show a live dashboard (no keys).

## Why it matters

Users may not know graceful vs force exit.

## Suggested direction

Document keybindings on --tui help; print legend on dashboard start.

## Severity

Medium

## Area

Dashboard / TUI
