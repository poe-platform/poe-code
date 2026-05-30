---
name: "Unconfigure Codex constructor provider deletes empty unrelated config"
---

# Unconfigure Codex constructor provider deletes empty unrelated config

## Summary

The Codex provider service treats an inherited `constructor` property as an installed model provider when unconfiguring a specific provider id. Calling the public `codexService.unconfigure()` API with `provider.id: "constructor"` against an otherwise unrelated Codex file containing only an empty `[model_providers]` table reports a removal and deletes the configuration file, despite no provider named `constructor` being configured.

## Reproduction

From the repository root, run this disposable passing in-memory probe:

```sh
cat > src/providers/__probe__.test.ts <<'EOF'
import { describe, expect, it } from "vitest";
import path from "node:path";
import { createMockFs } from "@poe-code/config-mutations/testing";
import { createCliEnvironment } from "../cli/environment.js";
import { createTestCommandContext } from "../../tests/test-command-context.js";
import { codexService } from "./codex.js";

describe("Codex inherited provider cleanup", () => {
  it("reports removal and deletes an empty provider table for absent constructor", async () => {
    const homeDir = "/home/test";
    const fs = createMockFs({}, homeDir);
    const configPath = path.join(homeDir, ".codex", "config.toml");
    await fs.mkdir(path.dirname(configPath), { recursive: true });
    await fs.writeFile(configPath, "[model_providers]\n", { encoding: "utf8" });

    const removed = await codexService.unconfigure({
      fs,
      env: createCliEnvironment({ cwd: homeDir, homeDir }),
      command: createTestCommandContext(fs),
      options: {
        env: createCliEnvironment({ cwd: homeDir, homeDir }),
        provider: { id: "constructor" }
      }
    });

    const exists = await fs.readFile(configPath, "utf8").then(() => true, () => false);
    console.log(JSON.stringify({ removed, exists }));
    expect(removed).toBe(true);
    expect(exists).toBe(false);
  });
});
EOF
trap 'rm -f src/providers/__probe__.test.ts' EXIT
npm exec -- vitest run src/providers/__probe__.test.ts --reporter verbose
```

The probe passes and prints:

```text
{"removed":true,"exists":false}

✓ src/providers/__probe__.test.ts > Codex inherited provider cleanup > reports removal and deletes an empty provider table for absent constructor
```

## Observed Behavior

`stripCodexConfiguration()` in `src/providers/codex.ts:87` through `src/providers/codex.ts:139` handles provider-specific removal. Its model-provider cleanup condition at `src/providers/codex.ts:126` through `src/providers/codex.ts:134` tests `id in providers` after parsing the TOML `[model_providers]` table into an ordinary object. For `id === "constructor"` and an empty table, that test succeeds through `Object.prototype.constructor`; deleting the non-own key leaves the table empty, so the function removes the table and reports `changed: true`. The exported unconfigure manifest at `src/providers/codex.ts:205` through `src/providers/codex.ts:220` then deletes the now-empty file and resolves success.

## Expected Behavior

Provider-specific Codex unconfiguration should remove a model provider only when that provider exists as an own configured entry. An absent provider named `constructor` must be treated as a no-op, preserving unrelated empty user configuration and reporting no removal.

## Impact

Callers that pass user-controlled, corrupted, or stale provider metadata into Codex cleanup can delete a user configuration file even when Poe Code never configured the requested provider. The command result falsely reports successful cleanup and silently removes unrelated persisted configuration state.
