# Public text prompt default validation

## Confirmed behavior

The public TTY `textPrompt` API, also exposed through `prompts.text`, validates
raw input before finalization substitutes `value || opts.defaultValue || ""`.
Submitting empty input can therefore reject a valid default or accept an invalid
default. No real command caller was found combining defaultValue and validate;
this is a public prompt API bug, not a confirmed broken command.

## Scoped fix

- Modify only interactive `text.ts`, its colocated `text.test.ts`, and this plan.
- Wrap the validator to validate the same effective value used by finalization.
- Preserve whitespace and empty-default semantics, typed and initial overrides,
  placeholder behavior, cancellation, and non-TTY behavior.
- Make no core lifecycle or API changes and add no dependencies.

## TDD and validation

- Confirm red before production edits using in-memory prompt streams.
- Cover valid defaults and exact validator input, invalid defaults and editable
  recovery, and clearing initial input with Ctrl+U before accepting the fallback.
- Keep controls for typed/initial overrides, whitespace, empty validation without
  a default, empty defaults, and placeholders that are not submitted values.
- Clean up pending prompts even when assertions fail so red does not time out.
- Run focused text tests, relevant prompt tests, scoped ESLint, and type checking.
- Do not edit concurrent pagination, select, multiselect, or completion work.

## Parent visual QA

The parent captured and inspected `screenshots/ux-text-default-validation-before.png`,
showing demo followed by Name is required; cancellation was clean. The parent owns
after-change actual PTY validation, screenshots, and review. Verify a valid default
submits and an invalid default stays editable until replaced with valid input.

### Parent review and after-change QA

- Reviewed the text-only validator adapter: it uses the same fallback expression
  as submission and leaves shared lifecycle, other prompts, and non-TTY input alone.
- In an actual TTY, Enter accepted `demo`; the validator received exactly `demo`.
  A second prompt rejected the default `bad`, remained editable, and accepted
  typed `Ada`. Its validator received exactly `bad`, then `Ada`.
- Captured and inspected `screenshots/ux-text-default-validation-after.png`,
  showing successful default submission, the editable invalid-default error,
  and successful replacement. Both prompts restored the cursor and exited cleanly.
- Parent reran text and completion tests together: all 298 passed. This is a
  public prompt API correction; QA did not execute a business command, modify
  user configuration, or add dependencies.

## Validation results

- Red: four expected failures exposed raw empty-string validation for a valid
  default, Ctrl+U fallback, whitespace default, and invalid default. Sixteen
  controls passed; the suite took 72 ms without timeout-based assertions.
- Green: all 20 text tests passed in 67 ms after the two-line production change.
- Broader validation: all 37 text, core, and public prompt-wrapper tests passed.
- Scoped ESLint, package type checking, root `npm run lint:types`, and scoped
  `git diff --check` passed.
- The parent was notified once the focused suite was green; actual after-change
  PTY screenshots and review remain with the parent.
