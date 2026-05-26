# Configure OpenCode replaces existing enabled provider list

## Summary

Running OpenCode configuration replaces an existing `enabled_providers` list with `['poe']`, silently disabling unrelated providers that the user had already enabled.

## Environment

- Date reproduced: 2026-05-26
- Repository branch: `main`
- Package version: `0.0.0-dev`
- Runtime: focused Vitest probe using the in-memory config filesystem

## Reproduction

Create a disposable test at `src/providers/__probe__.test.ts` that seeds an OpenCode config with multiple user-enabled providers, invokes `openCodeService.configure(...)`, and expects configuration to add Poe without removing the existing providers:

```ts
import { describe, expect, it } from "vitest";
import path from "node:path";
import { createMockFs } from "@poe-code/config-mutations/testing";
import { createCliEnvironment } from "../cli/environment.js";
import { DEFAULT_FRONTIER_MODEL, PROVIDER_NAME } from "../cli/constants.js";
import { createTestCommandContext } from "../../tests/test-command-context.js";
import { openCodeService } from "./opencode.js";

describe("OpenCode configure provider preservation probe", () => {
  it("preserves user-enabled providers when enabling Poe", async () => {
    const homeDir = "/home/user";
    const configPath = path.join(homeDir, ".config", "opencode", "config.json");
    const env = createCliEnvironment({ cwd: homeDir, homeDir });
    const fs = createMockFs({}, homeDir);
    await fs.mkdir(path.dirname(configPath), { recursive: true });
    await fs.writeFile(configPath, JSON.stringify({ enabled_providers: ["local", "anthropic"] }));
    await openCodeService.configure({
      fs,
      env,
      command: createTestCommandContext(fs),
      options: {
        env,
        provider: { id: PROVIDER_NAME, apiShape: "openai-chat-completions", baseUrl: "https://api.poe.com/v1", credential: "sk-test", extraEnv: {} },
        model: DEFAULT_FRONTIER_MODEL
      }
    });
    const config = JSON.parse(await fs.readFile(configPath, "utf8"));
    expect(config.enabled_providers).toContain("local");
    expect(config.enabled_providers).toContain("anthropic");
    expect(config.enabled_providers).toContain(PROVIDER_NAME);
  });
});
```

Run the focused probe and then delete it:

```sh
npm exec -- vitest run src/providers/__probe__.test.ts --reporter verbose
rm src/providers/__probe__.test.ts
```

## Observed Behavior

- After configuration, `enabled_providers` is exactly `['poe']` rather than preserving `local` and `anthropic`.
- The probe fails with `expected [ 'poe' ] to include 'local'`.
- Other config values may be merged, but the provider allowlist itself is destructively replaced.

## Expected Behavior

Configuring Poe support for OpenCode should preserve already enabled providers and add `poe` only if it is not already present.

## Impact

- Existing OpenCode providers can be disabled merely by configuring Poe Code integration.
- Users may lose access to previously configured model providers until they manually repair their allowlist.
- This occurs during normal configuration without warning that unrelated enabled providers are being removed.

## Supporting Evidence

In `src/providers/opencode.ts`, the configure manifest merges a value containing `enabled_providers: [PROVIDER_NAME]`. Since `PROVIDER_NAME` is `"poe"`, the merge replaces any pre-existing provider list instead of augmenting it.
