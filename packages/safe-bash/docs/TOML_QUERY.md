# TOML queries with yq

`yq` is an optional plugin for querying YAML or TOML from stdin and the virtual
filesystem. Register it explicitly; `agentCommands()` does not include it.

```ts
import { Shell, createMemoryFileSystem, yqCommands } from "@poe-platform/safe-bash";

const fs = createMemoryFileSystem();
await fs.writeFile("/config.toml", new TextEncoder().encode(
  '[package]\nname = "demo"\n',
));
const shell = new Shell({ fs }).use(yqCommands());
try {
  const result = await shell.exec("yq -p toml -o json -r '.package.name' /config.toml");
  console.log(result.stdout); // demo followed by a newline
} finally {
  await shell.dispose();
}
```

The package root and `@poe-platform/safe-bash/commands/yq` export
`yqCommands`, `createYqCommand`, `createYqCommands`, and `YqCommandsOptions`.
All factories accept `inputFormat: "yaml" | "toml"`, defaulting to `"yaml"`.
`yqCommands({ replace: true })` replaces an existing command; replacement defaults
to false. Configuration is validated and captured at creation. No environment
variables configure this command.

## Command options

```sh
yq -p toml -o json '.' /config.toml
yq --input-format=toml '.package' /config.toml
yq -p toml -o json -c '.items[] | select(.enabled)' /config.toml
```

- `-p FORMAT`, `--input-format FORMAT`, or `--input-format=FORMAT` selects `yaml`
  or `toml`, overriding the SDK input default. There is no format autodetection.
- `-o FORMAT`, `--output-format FORMAT`, or `--output-format=FORMAT` selects `yaml`
  or `json`. Output defaults to YAML. TOML output is unsupported.
- `-c` / `--compact-output` and `-r` / `--unwrapScalar` require explicit
  `-o json`. Raw output unwraps strings.
- `eval` / `e` is an optional leading command name. The filter defaults to `.`.
  File operands are read in order; absent files use stdin, and `-` names stdin.
- `--help` / `-h` and `--version` must appear alone, apart from `eval` / `e`.

The existing bounded jq-style query engine handles field selection, array
iteration, filters, construction, and query control flow. This is a restricted
profile, not a promise of compatibility with every external yq implementation.

## TOML input profile

Each source is one UTF-8 TOML document; an empty document produces `{}`. YAML
document markers inside TOML multiline strings are ordinary string content.
The reader supports TOML 1.0 bare, quoted and dotted keys, tables, arrays of
tables, inline tables, arrays, booleans, basic and literal strings (including
multiline forms), comments, numeric forms, and date/time syntax. Duplicate or
incompatible table/key definitions and malformed input are refused.

The query value model imposes two deliberate restrictions:

- Integers outside JavaScript's safe integer range and nonfinite numbers are
  refused. The reader does not silently round a TOML 64-bit integer.
  Floating-point forms with an unsafe integral value, such as `1e100`, are
  also refused under the existing yq numeric profile.
- Validated date/time values become their exact source strings, retaining
  fractional digits, offsets, and local date/time spelling. JSON and YAML output
  do not retain TOML's date/time type, comments, or formatting.
  Year `0000` and leap-second `:60` values are outside this reader's date profile.

Input, query arguments, and filenames must have lossless UTF-8 representations.
Input comes only from the configured virtual filesystem or stdin.

## Fixed limits and outcomes

The existing yq limits are fixed; there is no limit override option. Parsing,
query execution, traversal, and encoding share cooperative work accounting.
Implicit tables, keys, collection members, and retained values count toward
their respective bounds. A document below the byte cap may exceed a work or
structure cap.

| Resource | Limit |
| --- | ---: |
| Total input bytes | 16,000,000 |
| Bytes per document / retained value bytes per document | 8,388,608 each |
| Scalar bytes | 1,048,576 |
| Query source bytes | 8,192 |
| Value depth / query AST depth | 128 / 64 |
| Charged work steps | 1,000,000 |
| Results / collection members / document nodes | 100,000 each |
| Documents | 1,024 |
| Combined output bytes | 16,777,216, including 4,096 reserved for diagnostics |
| Argument entries / argument UTF-8 bytes | 4,096 / 65,536 |
| File operand bytes | 16,384 |

YAML additionally limits anchors per document and alias references to 1,024
each. TOML has neither feature. Diagnostics bound displayed filenames to 256
bytes. Cancellation preserves its supplied reason and closes owned input/query
resources; an uncooperative external operation cannot be forcibly interrupted.
Output honors backpressure, and a late failure may leave already-written output.

| Exit status | Meaning |
| --- | --- |
| 0 | Successful evaluation |
| 2 | Invalid command arguments or virtual filesystem input failure |
| 3 | Query compilation failure |
| 5 | Input syntax/encoding, schema, query runtime, encoding, or resource failure |

Input parsing failures occur outside query `try`/`catch`; a query cannot turn
invalid TOML into a successful result.
