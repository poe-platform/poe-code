# Toolcraft codemode negative search limit silently hides matching commands

## Summary

The exported `@poe-code/toolcraft-codemode` search command accepts a negative `limit` and successfully returns no results, even when the query matches an available command. An invalid caller-supplied result count is therefore indistinguishable from a valid search with no matching tools.

## Reproduction

Create the following disposable probe at `packages/toolcraft-codemode/src/__probe__.test.ts`:

```ts
import { expect, it } from "vitest";
import { defineCommand, defineGroup } from "toolcraft";
import { S } from "toolcraft-schema";
import { makeSearchCommand } from "./search.js";
import { resolveCommandTree } from "./tree.js";

it("silently hides matching commands when search limit is negative", async () => {
  const command = defineCommand({
    name: "create",
    description: "Create task",
    scope: ["sdk"],
    params: S.Object({}),
    handler: async () => null
  });
  const root = defineGroup({ name: "root", children: [command] });
  const entries = (await resolveCommandTree(root)).entries;
  const search = makeSearchCommand({ entries });

  await expect(search.handler({ params: { query: "create", limit: -1 } } as never)).resolves.toEqual(
    []
  );
});
```

Run the probe and then remove it:

```sh
npm exec -- vitest run packages/toolcraft-codemode/src/__probe__.test.ts --reporter verbose
rm packages/toolcraft-codemode/src/__probe__.test.ts
```

The probe passes and records:

```text
✓ packages/toolcraft-codemode/src/__probe__.test.ts > silently hides matching commands when search limit is negative
```

## Observed Behavior

`packages/toolcraft-codemode/src/search.ts` defines `limit` as an optional unconstrained number. Its `normalizeLimit()` function converts any non-finite or non-positive value to `0`, and the search handler returns `[]` immediately whenever the normalized limit is zero. In the reproduction, a command named `create` is present and matches the query, but `limit: -1` resolves as an apparently successful empty search.

## Expected Behavior

Search should reject an invalid negative result limit with a clear validation error, or the public schema should constrain `limit` to a positive result count before command execution.

## Impact

Agents and MCP clients can lose discovery of available commands because a malformed pagination or limit value is treated as a valid no-match response. This can make usable tools appear unavailable and lead automated workflows to abandon supported actions without any diagnostic explaining the bad request.
