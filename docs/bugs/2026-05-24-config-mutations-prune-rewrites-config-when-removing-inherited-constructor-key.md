# Config mutations prune rewrites config when removing inherited constructor key

## Summary

`@poe-code/config-mutations` accepts shape objects describing keys to remove from a configuration file. The format `prune()` implementations use inherited membership checks, so a shape asking to remove `constructor` is treated as matching every ordinary configuration object even when the file has no own `constructor` key. Executing that prune reports a change and rewrites an otherwise unchanged JSON configuration file.

## Reproduction

Run a transient Vitest probe from the repository root:

```sh
cat > packages/config-mutations/src/__probe__.test.ts <<'PROBE'
import { describe, expect, it } from "vitest";
import { runMutations, configMutation } from "./index.js";

function memoryFs(initial: Record<string, string>) {
  const files = new Map(Object.entries(initial));
  const writes: Array<{ path: string; content: string }> = [];
  return {
    writes,
    readFile: async (path: string) => {
      const content = files.get(path);
      if (content === undefined) throw Object.assign(new Error("missing"), { code: "ENOENT" });
      return content;
    },
    writeFile: async (path: string, content: string) => { files.set(path, content); writes.push({ path, content }); },
    mkdir: async () => {},
    unlink: async (path: string) => { files.delete(path); },
    stat: async () => ({ isFile: () => true, isDirectory: () => false }),
    readdir: async () => []
  };
}

describe("config prune inherited keys", () => {
  it("rewrites a JSON file when asked to remove nonexistent inherited constructor", async () => {
    const fs = memoryFs({ "/home/test/settings.json": '{"keep":"value"}\n' });
    const outcome = await runMutations(
      [configMutation.prune({ target: "~/settings.json", shape: { constructor: {} } })],
      { fs: fs as never, homeDir: "/home/test" }
    );
    console.log(JSON.stringify({ outcome, writes: fs.writes }));
    expect(outcome.changed).toBe(true);
    expect(fs.writes).toHaveLength(1);
  });
});
PROBE
npm exec -- vitest run packages/config-mutations/src/__probe__.test.ts --reporter verbose
rm packages/config-mutations/src/__probe__.test.ts
```

Output:

```text
{"outcome":{"changed":true,"effects":[{"changed":true,"effect":"write","detail":"update"}]},"writes":[{"path":"/home/test/settings.json","content":"{\n  \"keep\": \"value\"\n}\n"}]}
✓ packages/config-mutations/src/__probe__.test.ts > config prune inherited keys > rewrites a JSON file when asked to remove nonexistent inherited constructor
```

## Observed Behavior

JSON `prune()` clones the parsed object, then tests `if (!(key in result))` before deletion at `packages/config-mutations/src/formats/json.ts:57` through `packages/config-mutations/src/formats/json.ts:99`. Because ordinary objects inherit `constructor`, a prune shape containing that key enters the deletion path and sets `changed = true` despite no own configuration property having existed. TOML and YAML formats use the same inherited-membership condition at `packages/config-mutations/src/formats/toml.ts:40` through `packages/config-mutations/src/formats/toml.ts:83` and `packages/config-mutations/src/formats/yaml.ts:43` through `packages/config-mutations/src/formats/yaml.ts:81`. The public executor serializes and writes whenever `changed` is true at `packages/config-mutations/src/execution/apply-mutation.ts:454` through `packages/config-mutations/src/execution/apply-mutation.ts:532`.

## Expected Behavior

Pruning should act only on own configuration keys actually present in parsed content. Removing a name that exists solely on `Object.prototype`, such as `constructor`, must be a no-op and must not rewrite the target file or report a mutation effect.

## Impact

Declarative provider unconfiguration or cleanup manifests can rewrite user configuration files even when the targeted configuration entry is absent. This creates unnecessary file churn, formatting loss, watcher-triggered side effects, and misleading “changed” outcomes based solely on inherited JavaScript object properties rather than real persisted configuration.
