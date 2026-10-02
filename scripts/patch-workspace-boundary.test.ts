import { readFileSync, existsSync } from "node:fs";
import { expect, it } from "vitest";

it("owns patch regressions and canonical dependencies in the private workspace", () => {
  const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
  const manifest = JSON.parse(read("packages/safe-bash-command-patch/package.json"));
  expect(manifest.private).toBe(true);
  expect(manifest.dependencies).toEqual({});
  expect(manifest.devDependencies).not.toHaveProperty("@poe-platform/safe-bash");
  expect(manifest.devDependencies).toHaveProperty("safe-bash-contracts");
  expect(manifest.devDependencies).toHaveProperty("safe-bash-diff-engine");
  expect(read("packages/safe-bash/src/commands/patch/index.ts").trim()).toBe('export * from "safe-bash-command-patch";');
  const parent = JSON.parse(read("packages/safe-bash/package.json"));
  expect(parent.poeCode.integration.privateWorkspaces[manifest.name].devDependencies).toEqual(manifest.devDependencies);
  expect(existsSync(new URL("../packages/safe-bash-command-patch/src/patch-parser.test.ts", import.meta.url))).toBe(true);
});

it("builds patch's canonical contracts and shared engine before workspace unit tests", async () => {
  const { createWorkspaceTestPlan } = await import("./build-workspaces.mjs");
  const { fileURLToPath } = await import("node:url");
  const plan = createWorkspaceTestPlan(fileURLToPath(new URL("../", import.meta.url)), { workspaces: ["safe-bash-command-patch"] });
  for (const name of ["safe-bash-contracts", "safe-bash-diff-engine", "safe-bash-io-engine", "@poe-code/safe-fs"]) {
    expect(plan.buildStages.some((stage: { name: string }) => stage.name === name), name).toBe(true);
  }
});
