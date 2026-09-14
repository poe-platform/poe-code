# Toolcraft CLI

## Union selectors

CLI union parameters use a selector derived from each branch's non-optional field names. Names follow the configured CLI casing and are joined with `+`.

Different field sets can produce the same selector text. For example, a literal field named `first+second` and two separate fields named `first` and `second` both produce `first+second`.

The first branch keeps its existing selector. Later branches with that same text receive a suffix containing their one-based position in the union declaration:

```text
first+second
first+second (branch 2)
```

This preserves working first-branch and non-colliding selectors while making every colliding branch independently selectable. Quote selectors containing spaces when invoking a shell command.

For an `audit read` command whose `payload` union contains those two branches:

```sh
audit read --payload-kind 'first+second' --payload.first+second literal
audit read --payload-kind 'first+second (branch 2)' --payload.first one --payload.second two
```

With snake-case CLI options, the selector flag is `--payload_kind`. Its values use the same disambiguation rule. Use the command's human-readable `--help` or interactive selector to see the available values.

Only the selected branch's fields reach the handler. Fields belonging to another branch are rejected, selected-branch defaults remain available, and inactive defaults stay out. These rules also apply to nested unions and streaming commands. The synthetic selector is not included in the handler's parameter object.

Selector disambiguation does not merge duplicate field option definitions across branches; shared-field registration remains a separate limitation.

## Structured enum choices

Command JSON help (`--help --output json`) and `createCLICommandTreeSnapshot` include a `choices` array for enum options. This includes ordinary parameters, positionals, nested fields, and synthetic union/oneOf selectors. Unlike the shortened human help, structured help lists every declared enum value.

Choices are CLI argument strings: numeric and boolean values appear as strings such as `"2"` and `"false"`. Nullable enums also include `"null"`. Values retain their spelling regardless of option-name casing; display labels are not substituted for accepted values. Quote values containing spaces when using a shell.

Discovery reads declared values without invoking command handlers or interactive `loadOptions` callbacks. It does not resolve runtime-dependent prompt choices. Each returned choices array is independent of the schema and later snapshots.

The command-tree snapshot also lists choices for enabled output, debug, and log-level controls. Non-enum fields do not acquire a choices array. This metadata addition does not change argument parsing, defaults, field visibility, variant requiredness, or the separate shared-field registration limitation.

## Output-format contexts

Each CLI invocation uses its own design-system output-format context. An explicit `--output` selection takes precedence over a surrounding `withOutputFormat` scope. Overlapping normal or streaming invocations retain their selected formatting for progress and error messages instead of borrowing another invocation's format.

CLI rendering does not rewrite `process.env.OUTPUT_FORMAT`. The caller's environment and surrounding design-system scope stay unchanged during and after the invocation. Code that needs the active design-system format can use `resolveOutputFormat`; child-process environment settings must be supplied explicitly rather than relying on a temporary parent-environment mutation.

This isolates formatting, not every aspect of concurrent CLI execution. In particular, process exit status and arbitrary command side effects are not made independent by the output-format context.

## Test-harness API versions

The `apiVersion` option passed to `createCommandTestHarness` also applies to its `cli()` method, including streaming commands and requirements inherited from groups. Matching and newer versions satisfy the declared minimum; older, malformed and missing versions retain the normal CLI diagnostics. Commands without an API-version requirement do not require a version.

## Current test-harness capture limitation

`createCommandTestHarness(...).cli()` currently collects result-emitter messages rather than complete process output. Its `stdout` can omit help, remove final newlines or combine stream events without separators, and contain an unformatted error message instead of the CLI's JSON error record. Its `stderr` is currently always empty, even when diagnostics are written to the process stream.

Custom formatter output is captured exactly, but that does not establish byte-exact capture for other paths. Assertions about actual stdout/stderr need an independent capture of `runCLI` or an isolated CLI process until the harness capture implementation is repaired. Output-format context isolation does not fix this separate limitation.

## Current parity-harness limitations

`createCommandTestHarness(...).parity()` currently transforms the supplied parameters before invoking its SDK, MCP and CLI routes. A successful `agree` result therefore does not establish that the original test input was accepted by every adapter.

- Unknown keys in ordinary objects are dropped, including nested objects, so inputs rejected by the real adapters can become three successful calls.
- Canonical non-camel field names and SDK-shaped aliases are not translated consistently. Use each actual adapter's input naming convention when checking those cases independently.
- Object arrays, object-valued records and variant branches are not serialized into the indexed/dotted CLI flags accepted by the real CLI. These can falsely disagree even when equivalent direct invocations succeed.
- An explicitly owned JavaScript `undefined` can become an omitted property. For a required field with a default, this can turn an SDK rejection into a successful defaulted call. MCP JSON and shell arguments cannot represent every JavaScript input, so a comparison must state its representation boundary rather than silently replace the scenario.
- The adapters share the harness's mutable filesystem, services and fetch implementation. A preceding adapter's effects can change the next adapter's starting state. Fresh, independently owned fixtures are needed to compare stateful behavior reliably.

These limitations remain open. For the affected cases, compare independent actual-adapter invocations and their handler payloads/errors, preserving invalid-input controls as well as successful examples. `harness.run()` uses SDK-shaped inputs; it is not a substitute for real MCP or CLI transport checks.

## Dynamic argument shape errors

An `Unsupported CLI argument shape` error identifies the parameter path and schema type at the rejected argument position. It does not mean that the schema type is unsupported everywhere.

For example, an object-valued record with a `name` field accepts `--entries.alpha.name Ada`, not a serialized object at `--entries.alpha`. An array of objects uses indexed members such as `--entries.0.name Ada`. JSON-valued fields are different: they accept a serialized JSON value directly.

This diagnostic change does not add dynamic variant-flag support or change preset parsing. Use the declared CLI schema and help to distinguish leaf arguments from nested members; the error no longer provides a generic supported-type list that contradicts the rejected shape.
