# Agent-spawn Python types codegen follows a symlinked output file and overwrites outside the repository

## Summary

`runAgentSpawnPythonTypeCodegen()` writes its generated Python bindings to the fixed repository path `packages/py-poe-spawn/src/poe_spawn/types.py` without rejecting a symbolic link at that file. A repository containing a symlinked generated-output file causes the normal codegen task to overwrite an arbitrary external target.

## Reproduction

1. From the repository root, save this disposable probe as `.tmp-probes/codegen-symlink-probe.mts`:

   ```ts
   import fs from "node:fs/promises";
   import os from "node:os";
   import path from "node:path";
   import { Project } from "ts-morph";
   import { runAgentSpawnPythonTypeCodegen } from "../src/codegen/agent-spawn-py-types.ts";

   const root = await fs.mkdtemp(path.join(os.tmpdir(), "poe-python-types-"));
   const repo = path.join(root, "repo");
   const outside = path.join(root, "outside.py");
   await fs.mkdir(path.join(repo, "packages", "py-poe-spawn", "src", "poe_spawn"), {
     recursive: true
   });
   await fs.writeFile(outside, "EXTERNAL ORIGINAL\n", "utf8");
   await fs.symlink(
     outside,
     path.join(repo, "packages", "py-poe-spawn", "src", "poe_spawn", "types.py")
   );

   const project = new Project({ useInMemoryFileSystem: true });
   project.createSourceFile(
     path.join(repo, "packages", "agent-spawn", "src", "acp", "types.ts"),
     `
   export interface SessionStartEvent { event: "session_start"; threadId?: string; }
   export interface SpawnResultEvent { event: "spawn_result"; exitCode: number; }
   export type KnownAcpEvent = SessionStartEvent | SpawnResultEvent;
   `
   );
   project.createSourceFile(
     path.join(repo, "packages", "agent-spawn", "src", "types.ts"),
     `export type SpawnMode = "read" | "edit";`
   );

   await runAgentSpawnPythonTypeCodegen({
     repoRoot: repo,
     project,
     spawnConfigs: [{ kind: "cli", agentId: "codex" }]
   });

   console.log(await fs.readFile(outside, "utf8"));
   console.log(await fs.realpath(path.join(repo, "packages", "py-poe-spawn", "src", "poe_spawn", "types.py")));
   ```

2. Execute it with `./node_modules/.bin/tsx .tmp-probes/codegen-symlink-probe.mts`.

## Observed Behavior

The external `outside.py` file is overwritten with generated binding source containing `class Agent`, and the configured output path realpaths to that external target. Codegen completes successfully despite writing outside its supplied repository root.

`GENERATED_TYPES_OUTPUT_PATH` defines the fixed generated location in `src/codegen/agent-spawn-py-types.ts:47`. `runAgentSpawnPythonTypeCodegen()` joins that path beneath `repoRoot`, reads it, then calls `fs.writeFile(outputPath, generated, "utf8")` in `src/codegen/agent-spawn-py-types.ts:91` without validating whether the output file is a symlink.

## Expected Behavior

Repository code generation should only rewrite canonical generated files located inside the selected repository root. A symlinked output file escaping the repository should be rejected rather than followed.

## Impact

A crafted checkout can turn the normal `npm run codegen:python-types` operation into an external file overwrite with the developer or CI agent's privileges. This is especially risky because generated outputs are routinely regenerated during builds and validation workflows.
