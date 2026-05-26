# Configure Kimi deletes untracked user Poe-prefixed models

## Summary

Running Kimi configuration deletes existing user-created `models` entries whose names begin with `poe/`, even when those entries were not created or tracked by Poe Code.

## Environment

- Date reproduced: 2026-05-26
- Repository branch: `main`
- Package version: `0.0.0-dev`
- Runtime: focused Vitest probe using the in-memory config filesystem

## Reproduction

Create a disposable test at `src/providers/__probe__.test.ts` that seeds a Kimi TOML config with one user-created Poe-prefixed model and one unrelated model, invokes `kimiService.configure(...)`, and expects both pre-existing models to survive:

```ts
import { describe, expect, it } from "vitest";
import path from "node:path";
import { createMockFs, parseToml, serializeToml } from "@poe-code/config-mutations/testing";
import { createCliEnvironment } from "../cli/environment.js";
import { DEFAULT_KIMI_MODEL, PROVIDER_NAME } from "../cli/constants.js";
import { createTestCommandContext } from "../../tests/test-command-context.js";
import { kimiService } from "./kimi.js";

describe("Kimi configure model ownership probe", () => {
  it("removes a user-created Poe-prefixed model while reconfiguring", async () => {
    const homeDir = "/home/user";
    const configPath = path.join(homeDir, ".kimi", "config.toml");
    const env = createCliEnvironment({ cwd: homeDir, homeDir });
    const fs = createMockFs({}, homeDir);
    await fs.mkdir(path.dirname(configPath), { recursive: true });
    await fs.writeFile(configPath, serializeToml({ models: {
      "poe/user-custom": { provider: "custom-poe", model: "user-custom", max_context_size: 12345 },
      "external/keep": { provider: "external", model: "keep", max_context_size: 67890 }
    } }));
    await kimiService.configure({
      fs,
      env,
      command: createTestCommandContext(fs),
      options: {
        env,
        provider: { id: PROVIDER_NAME, apiShape: "openai-chat-completions", baseUrl: "https://api.poe.com/v1", credential: "sk-test", extraEnv: {} },
        model: DEFAULT_KIMI_MODEL
      }
    });
    const models = parseToml(await fs.readFile(configPath, "utf8")).models as Record<string, unknown>;
    expect(models["external/keep"]).toBeDefined();
    expect(models["poe/user-custom"]).toBeDefined();
  });
});
```

Run the focused probe and then delete it:

```sh
npm exec -- vitest run src/providers/__probe__.test.ts --reporter verbose
rm src/providers/__probe__.test.ts
```

## Observed Behavior

- The unrelated `external/keep` model remains in the resulting Kimi config.
- The user-created `poe/user-custom` model is absent after configuration.
- The probe fails with `expected undefined to be defined` for `models["poe/user-custom"]`.

## Expected Behavior

Configuring Kimi should add or update Poe Code-owned model entries without deleting arbitrary user-authored models solely because their keys share the `poe/` namespace.

## Impact

- Users can lose independently managed Kimi model definitions when enabling or refreshing Poe Code integration.
- Custom Poe-compatible Kimi models cannot coexist reliably with Poe Code configuration.
- The deletion occurs during a normal configure operation without an ownership check or warning.

## Supporting Evidence

In `src/cli/constants.ts`, `PROVIDER_NAME` is `"poe"`. In `src/providers/kimi.ts`, the configuration merge uses `pruneByPrefix: { models: `${PROVIDER_NAME}/` }` before writing Poe Code's generated model catalog, so every existing `poe/` model is targeted regardless of its author or ownership.
