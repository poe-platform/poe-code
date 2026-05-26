# Toolcraft codemode constructor root group crashes host-module construction

## Summary

`toolcraft-codemode` accepts a normal Toolcraft root group named `constructor`, and the direct SDK can invoke commands beneath that root. When codemode builds its agent-script host modules, however, it uses ordinary object tables for module and lint-module lookup. The inherited `constructor` property is mistaken for an existing lint export array, causing module construction to throw before any codemode execution can begin.

## Reproduction

Create a disposable Vitest probe with an SDK-callable command beneath a root group named `constructor`:

```sh
cat > packages/toolcraft-codemode/src/__probe__.test.ts <<'EOF'
import { describe, expect, it } from "vitest";
import { createSDK } from "toolcraft/sdk";
import { defineCommand, defineGroup } from "toolcraft";
import { S } from "toolcraft-schema";
import { buildHostModules } from "./host-modules.js";

describe("codemode constructor root group", () => {
  it("throws while building modules for an otherwise callable root command", async () => {
    const root = defineGroup({
      name: "constructor",
      children: [
        defineCommand({
          name: "run",
          scope: ["sdk"],
          params: S.Object({}),
          handler: async () => "called"
        })
      ]
    });
    const sdk = createSDK(root) as { run(params: Record<string, never>): Promise<string> };

    await expect(sdk.run({})).resolves.toBe("called");
    await expect(buildHostModules(root, sdk)).rejects.toThrow("lintModule.push is not a function");
  });
});
EOF
trap 'rm -f packages/toolcraft-codemode/src/__probe__.test.ts' EXIT
npm exec -- vitest run packages/toolcraft-codemode/src/__probe__.test.ts --reporter verbose
nl -ba packages/toolcraft-codemode/src/host-modules.ts | sed -n '85,155p'
```

The probe passes:

```text
✓ packages/toolcraft-codemode/src/__probe__.test.ts > codemode constructor root group > throws while building modules for an otherwise callable root command
```

## Observed Behavior

The ordinary Toolcraft SDK resolves and invokes the command as `sdk.run({})`, proving that `constructor` is an accepted root-group name for this tree. Codemode derives the root module name from `root.name` at `packages/toolcraft-codemode/src/host-modules.ts:85` through `packages/toolcraft-codemode/src/host-modules.ts:87`, then initializes both `modules` and `lintModules` as plain objects at `packages/toolcraft-codemode/src/host-modules.ts:134` through `packages/toolcraft-codemode/src/host-modules.ts:135`. For module name `constructor`, `getOrCreateLintModule()` at `packages/toolcraft-codemode/src/host-modules.ts:94` through `packages/toolcraft-codemode/src/host-modules.ts:97` returns the inherited `Object` constructor function rather than creating an array, and `lintModule.push(entry.name)` at `packages/toolcraft-codemode/src/host-modules.ts:143` throws `lintModule.push is not a function`.

## Expected Behavior

Codemode should expose commands beneath any Toolcraft group name accepted by the underlying SDK, including keys inherited from `Object.prototype`, or reject unsupported names during tree construction before search and execution surfaces are presented. Module tables should represent module names as data rather than inheriting ambient object properties.

## Impact

A valid Toolcraft tree becomes unusable through codemode solely because its public root group is named `constructor`. Integrations that wrap an existing SDK tree cannot reliably add codemode without auditing every group-derived module name for JavaScript object-property collisions, and agents cannot execute otherwise functioning tools through the advertised meta-tool surface.
