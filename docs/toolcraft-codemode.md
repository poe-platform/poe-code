# Toolcraft codemode command contracts

## Ordinary commands

Codemode exposes SDK-visible commands as callable SafeJS host modules. Commands must return values supported by that execution boundary. Discovery and execution use the same resolved command catalog.

## Streaming commands

Managed SDK streams are not serializable host-call results. Codemode does not provide stream iteration, event collection, or cancellation inside a script.

A catalog containing an SDK-visible streaming command is rejected with a `UserError` naming the normalized command path and explaining that a bounded ordinary command is needed. This is a catalog configuration error: search, schema discovery, and execution reject consistently, even if a script would not call that stream. No handler or stream producer is started during validation. Streams are not silently advertised as ordinary functions or silently removed from an otherwise invalid catalog.

The same validation applies to `resolveCommandTree` and caller-supplied entry lists consumed by search, schema discovery, host-module construction, or execution. Promised entry lists are validated after resolution. Streams already excluded from SDK scope are absent from the default catalog and do not prevent ordinary commands from executing.

Use the streaming SDK directly when the caller needs a live stream. To expose a snapshot through codemode, supply an ordinary command with explicit event and time limits that returns a supported value. Such an adapter must own cancellation and cleanup; codemode does not add a collector or infer termination conditions. Alternatively, compose a separate codemode root containing only the ordinary commands intended for scripts.

This validation makes an unsupported composition explicit; it does not add streaming support or fix the separately tracked input-schema projection mismatch.

## Known input-discovery limitation

`get_schemas` and detailed/full search currently serialize the declared parameter schema, while host calls use SDK input conventions. Their schemas can therefore disagree with executable calls about member casing, SDK-only requiredness, excluded fields and defaults.

For example, a declared `user_id` member is supplied as `userId` to the SDK-backed host function, even though discovery currently lists `user_id`. Apply SDK casing only to declared members; arbitrary record keys and JSON payloads remain literal. Fields with defaults can be omitted when the SDK supplies their values, even if the advertised schema still lists them as required.

This remains an open discovery defect. Successful discovery is not proof that a supplied object is valid for the host function, and stack-formatting improvements do not resolve it.

## Runtime error stacks

Host-command errors retain their multiline message once in the returned stack header. Blank lines, trailing newlines and message text that resembles a stack frame remain part of the message; they are not appended again as additional frames when an error crosses an asynchronous call or is rethrown by a script.

The separate `error.message` still contains the original message. Correct stack presentation does not change command validation, schema discovery or which calls succeed.
