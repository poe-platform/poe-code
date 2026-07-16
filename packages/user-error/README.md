# @poe-code/user-error

The shared user-error type every workspace package throws for expected user
mistakes, and the guard the CLI renders them with.

`src/cli/errors.ts` cannot be imported from `packages/*`, so package code used to
throw a plain `Error` for recoverable conditions. `src/cli/bootstrap.ts` then
treated each one as a crash: an `Error:` prefix plus a `See logs at
~/.poe-code/logs/errors.log` pointer to a log that adds nothing for a typo. This
package gives packages a classification the CLI honours.

## Usage

```ts
import { UserError, isUserError } from "@poe-code/user-error";

throw new UserError('Unknown agent "clyde". Try: claude, codex, gemini.');

throw new UserError("No API key found.", {
  hint: "Create one at https://poe.com/api_key",
  cause: readError
});

if (isUserError(error)) {
  // render the message as guidance: no stack trace, no log pointer
}
```

Throw a `UserError` when the user can fix the condition themselves, and say how:
name the value that was rejected and the valid ones, the path that was searched,
or the URL that issues the key. Keep plain `Error` for genuine failures — those
should reach the log.

## Public API

- `UserError`: `Error` subclass with `name === "UserError"` and an optional
  `hint` for the recovery step. Accepts the standard `cause` option.
- `isUserError(error)`: true for a `UserError` **or** any `Error` whose `name` is
  `"UserError"`.

## Cross-bundle recognition

`isUserError` matches on `error.name`, not `instanceof`. `toolcraft` publishes its
own `UserError` (`packages/toolcraft/src/user-error.ts`) as a separately released
framework, and an instance crossing a bundle boundary fails `instanceof` against
this package's class. Name matching recognises both, and mirrors the existing
`isSilentError()` precedent in `src/cli/errors.ts`. toolcraft deliberately does
not depend on this package — the coupling would run the wrong way.

## Config Options

This package reads no configuration.

## Environment Variables

This package reads no environment variables.
