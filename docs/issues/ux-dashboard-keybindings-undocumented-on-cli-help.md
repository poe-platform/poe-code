---
severity: medium
impact: polish
reproduced: y
recommendation: fix
evidence: "src/cli/commands/pipeline.ts:888, experiment.ts:740, ralph.ts:776 all describe --tui as 'Show a live dashboard while ... is running' with no keys; packages/toolcraft-design/src/dashboard/keymap.ts:5-13 defines quit ['q'] and forceQuit ['Ctrl+C']. Note: dashboard footer already renders a legend (components/footer.ts defaultHints: q Quit, e Edit, l Log, p Pause, r Retry), so only the CLI help text gap remains; Ctrl+C is absent from the footer hints."
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
