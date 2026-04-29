# @poe-code/agent-script

Agent-script parsing, linting, execution, and state serialization APIs.

## Public API

- `parse()`
- `lint()`
- `run()`
- `dump()`
- `restore()`
- `deepCopyToSandbox()`
- `deepCopyFromSandbox()`

### Example

Use the deep-copy helpers when a custom module factory needs to move plain data across the host/sandbox boundary safely:

```ts
import { deepCopyFromSandbox, deepCopyToSandbox } from "@poe-code/agent-script";

export function makeCustomModule() {
  return {
    inspect(value: unknown) {
      const sandboxValue = deepCopyToSandbox(value);
      return deepCopyFromSandbox(sandboxValue);
    }
  };
}
```

## Config options

None.

## Env vars

None.
