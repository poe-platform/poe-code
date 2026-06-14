# QA: Design-system own prompts

## Setup

- Build the package: `npm run build -w toolcraft-design`.
- Use a terminal with a real TTY for interactive checks.

## Interactive Checks

- Run a command path that asks for text input, type a value, and press Enter. Confirm the typed value is accepted.
- Trigger a text validation error, confirm the yellow error state renders, edit the value, and submit successfully.
- Run a password prompt, type a value, and confirm only mask characters render.
- Run a confirm prompt, flip with arrow keys, submit with Enter, then repeat using `y` and `n`.
- Run a select prompt with at least three options, move up/down, confirm disabled options are skipped, and submit.
- Run a multiselect prompt, toggle with Space, toggle all with `a`, invert with `i`, and submit.
- For a required multiselect, press Enter with nothing selected and confirm the required error renders.
- Cancel each prompt with Ctrl-C and with Escape. Confirm callers receive cancellation and render the cancellation path.

## Terminal Behavior

- Resize the terminal while a prompt is active and confirm the prompt redraws without duplicating stale rows.
- Use a narrow terminal around 40 columns and confirm long messages/options wrap under the prompt gutter.
- Use a long select list with at least 30 items and confirm top/bottom `...` markers appear while scrolling.

## Non-TTY Checks

- Pipe text into a text prompt path and confirm the first piped line is returned.
- Run a non-TTY select/confirm/multiselect path without `POE_NO_PROMPT`; confirm it fails with the documented TTY error.
- Run the same non-TTY path with `POE_NO_PROMPT=1`; confirm it accepts the default or initial value.

## Node 18 Smoke

- Build first: `npm run build -w toolcraft-design`.
- Run under Node 18: `nvm exec 18.18 node packages/toolcraft-design/scripts/check-node18.mjs`.
