import { beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import rootUnitConfig from "../../vitest.root.config.js";
import { createWorkspaceTestPlan } from "../../scripts/build-workspaces.mjs";
import { sharedVitestStages } from "../../scripts/test-vitest-workspaces.mjs";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const PACKAGES_DIR = path.join(ROOT, "packages");

function readJson(filePath: string): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function getWorkspacePackagesWithTests(): string[] {
  const dirs = fs.readdirSync(PACKAGES_DIR, { withFileTypes: true });
  const result: string[] = [];

  for (const dir of dirs) {
    if (!dir.isDirectory()) continue;
    const pkgPath = path.join(PACKAGES_DIR, dir.name, "package.json");
    if (!fs.existsSync(pkgPath)) continue;

    const srcDir = path.join(PACKAGES_DIR, dir.name, "src");
    if (!fs.existsSync(srcDir)) continue;

    const hasTests = findTestFiles(srcDir);
    if (hasTests) {
      const pkg = readJson(pkgPath) as { name: string };
      // The optional E2E workspace intentionally has no maintained unit task.
      if (pkg.name !== "safe-bash-e2e") result.push(pkg.name);
    }
  }

  return result;
}

function findTestFiles(dir: string): boolean {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isFile() && entry.name.endsWith(".test.ts")) return true;
    if (entry.isDirectory()) {
      if (findTestFiles(path.join(dir, entry.name))) return true;
    }
  }
  return false;
}

describe("workspace dependency completeness", () => {
  let plan: ReturnType<typeof createWorkspaceTestPlan>;
  beforeAll(() => { plan = createWorkspaceTestPlan(ROOT); });
  it.each(["safe-bash-command-xz", "safe-bash-compression-engine"])("runs %s only through its declared Node task", name => {
    expect(rootUnitConfig.test?.exclude).toContain(`packages/${name}/src/*.test.ts`);
    const stages = sharedVitestStages(plan);
    expect(stages.filter(stage => stage.name === name)).toEqual([
      { id: `${name}#test:unit`, name, path: `packages/${name}`, event: "test:unit" }
    ]);
    expect(stages.find(stage => stage.event === "test:unit:shared")?.phases.some(phase => phase.name === name)).toBe(false);
  });

  it("builds truncate's canonical runtime prerequisites before its standalone unit task", () => {
    const config = readJson(path.join(ROOT, "turbo.json")) as { tasks: Record<string, { dependsOn?: string[] }> };
    expect(config.tasks["safe-bash-command-truncate#test:unit"]?.dependsOn).toContain("^build");
    expect(plan.testStages.filter(stage => stage.name === "safe-bash-command-truncate")).toEqual([
      { id: "safe-bash-command-truncate#test:unit", name: "safe-bash-command-truncate", path: "packages/safe-bash-command-truncate", event: "test:unit" }
    ]);
  });

  it("runs csvcut node:test files once through their declared workspace task", () => {
    expect(rootUnitConfig.test?.exclude).toContain("packages/safe-bash-command-csvcut/src/*.test.ts");
    expect(plan.testStages.filter(stage => stage.name === "safe-bash-command-csvcut")).toEqual([
      { id: "safe-bash-command-csvcut#test:unit", name: "safe-bash-command-csvcut", path: "packages/safe-bash-command-csvcut", event: "test:unit" }
    ]);
    expect(readJson(path.join(PACKAGES_DIR, "safe-bash-command-csvcut", "package.json"))).toMatchObject({
      scripts: { "test:unit": "node --import tsx --test src/*.test.ts" }
    });
  });
  it("keeps op node:test files out of Vitest while retaining their maintained workspace task", () => {
    const config = readJson(path.join(ROOT, "turbo.json")) as { tasks: Record<string, { dependsOn?: string[] }> };
    expect(config.tasks["safe-bash-command-op#test:unit"]?.dependsOn).toContain("^build");
    expect(rootUnitConfig.test?.exclude).toContain("packages/safe-bash-command-op/src/*.test.ts");
    expect(plan.testStages.filter(stage => stage.name === "safe-bash-command-op")).toEqual([
      { id: "safe-bash-command-op#test:unit", name: "safe-bash-command-op", path: "packages/safe-bash-command-op", event: "test:unit" }
    ]);
    expect(readJson(path.join(PACKAGES_DIR, "safe-bash-command-op", "package.json"))).toMatchObject({
      scripts: { "test:unit": "node --import tsx --test src/*.test.ts" }
    });
  });

  it("runs fold node:test suites through their maintained workspace task", () => {
    expect(rootUnitConfig.test?.exclude).toContain("packages/safe-bash-command-fold/src/*.test.ts");
    expect(plan.testStages.filter(stage => stage.name === "safe-bash-command-fold")).toEqual([
      { id: "safe-bash-command-fold#test:unit", name: "safe-bash-command-fold", path: "packages/safe-bash-command-fold", event: "test:unit" }
    ]);
    expect(readJson(path.join(PACKAGES_DIR, "safe-bash-command-fold", "package.json"))).toMatchObject({
      scripts: { "test:unit": "node --import tsx --test src/*.test.ts" }
    });
  });

  it("runs htmlq node:test suites only through the maintained private workspace task", () => {
    expect(rootUnitConfig.test?.exclude).toContain("packages/safe-bash-command-htmlq/src/*.test.ts");
    expect(plan.testStages.filter(stage => stage.name === "safe-bash-command-htmlq")).toEqual([
      { id: "safe-bash-command-htmlq#test:unit", name: "safe-bash-command-htmlq", path: "packages/safe-bash-command-htmlq", event: "test:unit" }
    ]);
    expect(readJson(path.join(PACKAGES_DIR, "safe-bash-command-htmlq", "package.json"))).toMatchObject({
      scripts: { "test:unit": "node --import tsx --test src/*.test.ts" }
    });
  });

  it("keeps the optional safe-bash E2E suite out of maintained unit tasks", () => {
    expect(rootUnitConfig.test?.exclude).toContain("packages/safe-bash-e2e/**");
    expect(plan.testStages.some(stage => stage.name === "safe-bash-e2e")).toBe(false);
    const manifest = readJson(path.join(PACKAGES_DIR, "safe-bash-e2e", "package.json")) as {
      scripts: Record<string, string>;
    };
    expect(manifest.scripts["test:unit"]).toBeUndefined();
    expect(manifest.scripts["test:e2e"]).toBeDefined();
  });

  it("schedules each package with unit tests once through its declared unit task", () => {
    const scheduled = sharedVitestStages(plan).flatMap(stage => stage.event === "test:unit:shared"
      ? stage.phases.map(phase => phase.name)
      : [stage.name]);
    for (const name of getWorkspacePackagesWithTests()) {
      expect(scheduled.filter(owner => owner === name),
        `Expected one maintained unit task for ${name}; declare test:unit in its workspace package.json.`
      ).toEqual([name]);
    }
  });
});
