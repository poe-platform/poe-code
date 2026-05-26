# Agent skill config returned agent config mutation redirects future installs

## Summary

The exported `@poe-code/agent-skill-config` `getAgentConfig()` API returns the package's live internal configuration object. Mutating that returned object changes destinations used by subsequent `configure()` calls, allowing one SDK consumer to redirect later skill installations for the process.

## Environment

- Date reproduced: 2026-05-26
- Repository branch: `main`
- Package version: `0.0.0-dev`
- Runtime: focused Vitest probe using an in-memory filesystem

## Reproduction

Create a disposable probe at `packages/agent-skill-config/src/__probe__.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { Volume, createFsFromVolume } from "memfs";
import type { FileSystem } from "@poe-code/config-mutations";
import { configure } from "./apply.js";
import { getAgentConfig } from "./configs.js";

describe("agent skill exported config mutability probe", () => {
  it("does not let callers redirect later configuration by mutating a returned config", async () => {
    const exposed = getAgentConfig("claude-code")!;
    const original = exposed.globalSkillDir;
    exposed.globalSkillDir = "~/.redirected/skills";

    const homeDir = "/home/test";
    const cwd = "/repo";
    const volume = Volume.fromJSON({}, "/");
    volume.mkdirSync(homeDir, { recursive: true });
    volume.mkdirSync(cwd, { recursive: true });
    const fs = createFsFromVolume(volume).promises as unknown as FileSystem;

    try {
      await configure("claude-code", { fs, homeDir, cwd });
      await expect(fs.stat(`${homeDir}/.claude/skills/poe-generate.md`)).resolves.toBeDefined();
      await expect(fs.stat(`${homeDir}/.redirected/skills/poe-generate.md`)).rejects.toThrow();
    } finally {
      exposed.globalSkillDir = original;
    }
  });
});
```

Run the focused probe and remove it:

```sh
npm exec -- vitest run packages/agent-skill-config/src/__probe__.test.ts --reporter verbose
rm packages/agent-skill-config/src/__probe__.test.ts
```

## Observed Behavior

- Mutating `getAgentConfig("claude-code")!.globalSkillDir` to `~/.redirected/skills` modifies the destination used by a later `configure("claude-code", ...)` call.
- The bundled skill is written under `~/.redirected/skills` rather than the declared Claude skill location `~/.claude/skills`.
- The probe fails because the expected normal target does not exist after configuration.

## Expected Behavior

Reading an agent's public skill-directory configuration should not grant mutation access to internal registry state. Callers should receive immutable data or detached copies so later installations retain canonical destinations.

## Impact

- Any in-process SDK consumer can unintentionally or maliciously redirect future skill writes for another feature or caller.
- Installation output and agent behavior can depend on prior unrelated reads and object mutation, causing nondeterministic state corruption.
- A long-lived host process can be poisoned until its module state is reset or the returned object is manually restored.

## Supporting Evidence

In `packages/agent-skill-config/src/configs.ts`, `agentSkillConfigs` stores mutable objects and `getAgentConfig()` returns `support.config` directly rather than cloning or freezing it. In `packages/agent-skill-config/src/apply.ts`, `configure()` reads the same returned registry object's `globalSkillDir` to construct mutation targets, so changes made through the public getter immediately affect future writes.
