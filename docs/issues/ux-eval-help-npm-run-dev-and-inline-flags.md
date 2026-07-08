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
