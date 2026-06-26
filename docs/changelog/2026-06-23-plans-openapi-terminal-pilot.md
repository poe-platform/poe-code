# 2026-06-23 Plans, OpenAPI Skills, and Terminal Pilot Updates

This entry summarizes the commits that landed on `main` during the 24-hour window ending 2026-06-24 00:30 UTC.

## Plan browser

- `poe-code plan` can save active plans for later from the explorer with `s`, move them into the plan directory's `later/` subdirectory, and restore saved plans back to the active directory with the same key.
- Saved plans can carry `saved_for_later.reason` metadata in Markdown frontmatter or YAML plan files. The explorer prompts for a reason when saving a plan that does not already provide one.
- Plan discovery now includes the `later/` subdirectory, groups saved plans after active plans, and keeps saved metadata in the public `PlanEntry` shape.
- Plan frontmatter schemas allow additional metadata so plan-specific tools can preserve fields such as `saved_for_later` without schema failures.

## Toolcraft OpenAPI

- `toolcraft-openapi-generate` accepts generated skill output paths that pass through symlinks resolving inside the project, including project-local skill indirections such as `.claude/skills -> ../.agents/skills`.
- Generated skill paths that resolve outside the project are still rejected before writes, so the relaxed symlink handling does not permit project escape.

## Terminal Pilot and explorer prompts

- The `terminal-pilot` CLI now uses an on-demand background daemon for session commands, allowing separate CLI invocations to share named PTY sessions while avoiding process-local state leaks.
- `TERMINAL_PILOT_SESSION` can provide the default session name for commands that target a session, and `TERMINAL_PILOT_RUNTIME_DIR` can override the daemon socket directory.
- Toolcraft explorer actions pause keypress handling while suspended prompts or editors run, preventing explorer shortcuts from consuming prompt input.
- The terminal-pilot process regression suite was kept fast by avoiding slow real-process paths in the targeted session-isolation test.
