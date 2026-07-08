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
