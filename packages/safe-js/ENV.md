# Explicit environment capabilities

SafeJS does not expose `process` or register an environment module by default.
The host grants individual names. Scripts cannot enumerate, write, or widen that
grant through the environment module.

```ts
import { makeEnvModule, run } from "poe-code/safe-js";

const env = makeEnvModule({
  allow: ["REGION", "OPTIONAL_TOKEN"],
  values: { REGION: "local" }
});
await run('import {get} from "env"; return get("REGION");', {
  modules: { env }
});
```

## Configuration

| Option | Default | Meaning |
| --- | --- | --- |
| `allow` | Required | Array of exact environment variable names to grant. An empty array grants nothing. |
| `values` | Host environment | Optional string/undefined record. When supplied, it replaces the ambient source rather than merging with it. |

`makeEnvModule(["REGION"])` is shorthand for `{ allow: ["REGION"] }`. The
allow-list and explicitly supplied values are copied at construction. Only
granted own data properties are copied; denied and inherited properties are not
read. A granted accessor or non-string/non-undefined value is invalid. Options
reject accessors and unknown fields. `parseEnvConfig(json)` parses and validates
the same options object without registering a module.

With no `values` option, `get` reads the granted own property from `process.env`
at call time. With `values: {}`, every granted variable is missing, even if the
host has a value for it. Explicit undefined and absent values both mean missing;
JSON configurations represent missing values by omitting their keys.

Names are exact and case-sensitive capabilities. They are not trimmed or
case-folded. Unicode, whitespace, and names such as `__proto__` remain ordinary
names. Empty names, NUL, and equals signs are rejected. Ambient lookup follows
the host platform's environment behavior, but the grant check always compares
the exact requested name first.

## Reads and errors

The only script export is synchronous `get(name)`:

- Granted and present: returns its string, including an empty string.
- Granted and missing: returns `undefined`.
- Not granted: throws `EnvAccessError` with `code: "ENV_ACCESS_DENIED"` and
  `variable: name`, before accessing the value source.
- Invalid name: throws `TypeError` without coercion or truncation.

```js
import { get } from "env";

try {
  return get("OPTIONAL_TOKEN") ?? "not configured";
} catch (error) {
  if (error.code === "ENV_ACCESS_DENIED") return "not granted";
  throw error;
}
```

SDK callers can import `EnvAccessError` and use `instanceof EnvAccessError`.
Sandbox code receives an `Error` with the structured name/code/variable fields;
it does not receive the host constructor or prototype. Error messages contain
the requested name, not any variable value. The module itself exports no source
record, allow-list, enumeration method, or process object.

## CLI and SDK parity

```sh
poe-safe-js --env-config ./env.json script.ajs
poe-code harness run harness.md --env-config ./env.json --yes
```

```json
{
  "allow": ["REGION", "OPTIONAL_TOKEN"],
  "values": { "REGION": "local" }
}
```

Omit `values` to grant named host variables instead of supplying fixed values.
Paths are resolved from the command's working directory. Root harness commands
use their CLI container's environment; the standalone CLI uses its process
environment. Invalid configuration fails before script execution, including
root CLI dry runs. Script frontmatter never grants environment access.

`runCli(argv, { env: options })` accepts the same configuration directly. Do not
combine it with `--env-config` or another `env` module from `modulesFor`. Core
SDK callers register the module explicitly through `run({ modules: { env } })`.

## Replay and secrets

Completed reads and denial errors retain their recorded outcomes through JSON
checkpoint replay, including their structured error fields. The host supplies
the module again when restoring. New reads use that restored module's grants
and values; revocation does not erase historical observations already present
in a checkpoint. Read operations have no external write side effect.

Snapshots, explicit configuration files, and script output can contain granted
secrets. Protect them as secret-bearing data; the sandbox does not redact data
the host intentionally gives a script. Denied and unused host values are not
copied into a snapshot merely because they exist in the host environment.

Previously denied reads returned undefined and names were silently trimmed.
This release intentionally removes that ambiguity: check for denial separately
from a granted-but-missing variable, and grant the exact name being requested.
