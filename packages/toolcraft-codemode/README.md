# toolcraft-codemode

Code-mode meta-tools for toolcraft trees, sandboxed by SafeJS.

## Why

Code-mode addresses two scaling problems in large toolcraft trees:

- Catalog context bloat: expose three stable meta-tools instead of dumping every command schema into the model context.
- Intermediate-token waste: let the model generate one script that searches, fetches schemas, and calls commands in-process instead of spending a model turn per tool call.

The sandbox is `@poe-code/safe-js`, not a custom runtime.

## Install + Hello World

```bash
npm install toolcraft-codemode toolcraft
```

```ts
import { runMCP } from "toolcraft/mcp";
import { codeMode } from "toolcraft-codemode";
import { root } from "./tools.js";
export async function main() {
  await runMCP(codeMode(root), {
    name: "my-code-mode",
    version: "0.1.0"
  });
}
void main();
```

## Meta-Tools

### `search`

Params: `{ query: string; limit?: number; detail?: "brief" | "detailed" | "full" }`

Returns: `Array<{ path: string; description: string; schema?: object }>`

### `get_schemas`

Params: `{ names: string[] }`

Returns: `Record<string, { description: string; params: JsonSchema }>`

### `execute`

Params: `{ source: string }`

Returns:

```ts
type ExecuteResult =
  | { ok: true; returnValue: unknown; stats: unknown }
  | { ok: false; kind: "lint"; diagnostics: Diagnostic[] }
  | { ok: false; kind: "runtime"; error: { message: string; code?: string; stack?: string } };
```

On success, the model's script return value is returned by the `execute` tool as `returnValue`. Lint failures return `{ ok: false, kind: "lint", diagnostics }`; they are not thrown as exceptions.

## SafeJS Subset

The model must emit source accepted by [`@poe-code/safe-js`](../safe-js/README.md). This package does not define a second grammar.

## Configuration Options

`codeMode(root, options?: CodeModeOptions)` wraps a toolcraft root in a `code_mode` group.

| Field                  | Default           | Controls                                                                    |
| ---------------------- | ----------------- | --------------------------------------------------------------------------- |
| `services`             | `undefined`       | Passed through to the internal toolcraft SDK used by `execute`.             |
| `casing`               | SDK default       | Passed through to `createSDK`; only `"camel"` is accepted by the SDK type.  |
| `humanInLoop`          | `undefined`       | Passed through to `createSDK` for commands that use human-in-loop behavior. |
| `apiVersion`           | `undefined`       | Passed through to `createSDK` for `requires.apiVersion` checks.             |
| `projectRoot`          | toolcraft default | Passed through to `createSDK` and command-tree resolution.                  |
| `errorReports`         | toolcraft default | Passed through to `createSDK` error-report handling.                        |
| `budget.maxSteps`      | SafeJS default    | Maximum interpreter steps for `execute`.                                    |
| `budget.deadline`      | SafeJS default    | Deadline for `execute`, as a timestamp or `Date`.                           |
| `budget.maxCallDepth`  | SafeJS default    | Maximum script call depth for `execute`.                                    |
| `budget.stringLength`  | SafeJS default    | Maximum string length allowed by the interpreter.                           |
| `budget.arrayLength`   | SafeJS default    | Maximum array length allowed by the interpreter.                            |
| `search.scope`         | `["mcp", "sdk"]`  | Scope for the `search` meta-tool.                                           |
| `search.defaultDetail` | `"brief"`         | Detail level used when `search.detail` is omitted.                          |
| `search.defaultLimit`  | `10`              | Result count used when `search.limit` is omitted.                           |
| `getSchemas.scope`     | `["mcp", "sdk"]`  | Scope for the `get_schemas` meta-tool.                                      |
| `execute.scope`        | `["mcp", "sdk"]`  | Scope for the `execute` meta-tool.                                          |

## Environment Variables

This package does not read public environment variables directly.
