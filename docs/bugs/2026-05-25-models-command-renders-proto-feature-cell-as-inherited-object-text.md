---
name: "`models` Command Renders a `__proto__` Feature Cell as Inherited Object Text"
---

# `models` Command Renders a `__proto__` Feature Cell as Inherited Object Text

## Summary

The public `poe-code models` command builds dynamic feature columns from remote model metadata. If a returned model advertises a supported feature named `__proto__`, the command displays `[object Object]` in that feature cell instead of its normal success marker because it assigns the feature value into an ordinary row object.

## Reproduction

Create a disposable Vitest probe at `src/cli/commands/__probe__.test.ts`:

```ts
import { Volume, createFsFromVolume } from "memfs";
import { describe, expect, it, vi } from "vitest";
import { createProgram } from "../program.js";
import type { HttpClient } from "../http.js";
import type { FileSystem } from "../utils/file-system.js";

describe("models remote feature prototype-key repro", () => {
  it("renders inherited object text instead of the supported __proto__ check mark", async () => {
    const volume = new Volume();
    volume.mkdirSync("/home/test", { recursive: true });
    const fs = createFsFromVolume(volume).promises as unknown as FileSystem;
    const logs: string[] = [];
    const httpClient: HttpClient = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ object: "list", data: [{
        id: "model-a", object: "model", created: 1700000000000, owned_by: "Provider",
        context_window: null, supported_features: ["__proto__"], supported_endpoints: null,
        pricing: null, architecture: null, reasoning: null, parameters: []
      }] })
    })) as HttpClient;
    const program = createProgram({
      fs,
      prompts: vi.fn(),
      env: { cwd: "/repo", homeDir: "/home/test" },
      httpClient,
      logger: (message) => logs.push(message),
      suppressCommanderOutput: true
    });

    await program.parseAsync(["node", "cli", "models"]);

    expect(logs.join("\n")).toContain("__proto__");
    expect(logs.join("\n")).toContain("[object Object]");
  });
});
```

Run:

```sh
npm exec -- vitest run src/cli/commands/__probe__.test.ts --reporter verbose
```

The probe passes, confirming that the rendered table labels the remote feature but displays inherited object content for its value rather than the intended supported-feature indicator. Remove the disposable probe after validation.

## Observed Behavior

When the models endpoint returns one model with `supported_features: ["__proto__"]`, `poe-code models` outputs a `__proto__` table column whose cell reads `[object Object]`, not `✓`. In `src/cli/commands/models.ts`, remote feature names become column names and each row is initialized as a normal object; the loop stores feature values via `row[feature] = theme.success("✓")`. For `feature === "__proto__"`, no own string cell is created, and terminal table rendering later reads `row[column.name]`, yielding the inherited object value.

## Expected Behavior

The models display should render the normal support indicator for every feature returned by the models endpoint, including a feature identifier named `__proto__`, or safely reject unsupported metadata values rather than display unrelated inherited object content.

## Impact

Server-provided model capability metadata can corrupt terminal output visible to users. Operators may see misleading feature support information when choosing models or debugging provider capabilities, and the displayed value reveals an implementation artifact instead of the advertised remote feature state.
