---
severity: critical
impact: discoverability
comment: "Critical is not defensible for help formatting when this audit rates broken first-run behavior (ux-eval-check-fails-on-placeholder-target-git-remote.md) merely High - re-rate down and align with the identity cluster. That said, it is the best-argued help filing: of the four problems it bundles, the unreadable inline run flags line is genuinely distinct and worth keeping, since users cannot discover eval flags at any normal terminal width. The npm run dev, title and casing halves duplicate the identity cluster rooted in ux-development-mode-usage-intentional-but-leaks.md. Its closing observation is the valuable one: eval and superintendent share a command-registration pattern, so fix at the source."
---

# UX: eval --help shows npm run dev usage, all-caps headers, inline flag overflow

## Summary

`eval --help` suffers the same systemic formatting problems as `superintendent --help`:

1. **Usage line leaks internal dev invocation**: `npm run dev -- eval [command] [OPTIONS]` — should be `poe-code eval`.
2. **Redundant "poe-code" in title**: "Poe - poe-code eval" — should be "Poe - eval".
3. **All-caps "COMMANDS" header** instead of "Commands:" used everywhere else.
4. **`run` subcommand dumps all flags inline**, producing a line that extends far beyond the terminal width:
   ```
   run --agent <value...> --model <value...> [-C, --cwd <value>] [--eval <value...>] [--repeats <value>] [--judge <value>] [--no-judge] [--no-verify] [--out <value>]
   ```
   This is completely unreadable at any normal terminal width.

## Evidence

Screenshot shows `run` command row starting at the left edge and extending off-screen to the right. All four issues confirmed visually.

## Why it matters

Same impact as `superintendent`: installed users are told to run a developer script. The `run` options line is so wide it cannot be read — users have no way to discover eval flags without running `eval run --help` directly.

## Suggested direction

Same fix needed as `superintendent`: normalise binary name ($0), strip "poe-code" prefix, use "Commands:" casing, truncate subcommand lines to `run [options]`.

Note: `eval` and `superintendent` share this problem — likely a shared command-registration pattern that needs fixing at the source.

## Severity

Critical

## Area

Eval / help / usage line / formatting
