import { describe, expect, it } from "vitest";
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
      result.push(pkg.name);
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
  it.each(["safe-bash-command-xz", "safe-bash-compression-engine"])("runs %s only through its declared Node task", name => {
    expect(rootUnitConfig.test?.exclude).toContain(`packages/${name}/src/*.test.ts`);
    const stages = sharedVitestStages(createWorkspaceTestPlan(ROOT));
    expect(stages.filter(stage => stage.name === name)).toEqual([
      { id: `${name}#test:unit`, name, path: `packages/${name}`, event: "test:unit" }
    ]);
    expect(stages.find(stage => stage.event === "test:unit:shared")?.phases.some(phase => phase.name === name)).toBe(false);
  });

  it("runs csvcut node:test files once through their declared workspace task", () => {
    expect(rootUnitConfig.test?.exclude).toContain("packages/safe-bash-command-csvcut/src/*.test.ts");
    const plan = createWorkspaceTestPlan(ROOT);
    expect(plan.testStages.filter(stage => stage.name === "safe-bash-command-csvcut")).toEqual([
      { id: "safe-bash-command-csvcut#test:unit", name: "safe-bash-command-csvcut", path: "packages/safe-bash-command-csvcut", event: "test:unit" }
    ]);
    expect(readJson(path.join(PACKAGES_DIR, "safe-bash-command-csvcut", "package.json"))).toMatchObject({
      scripts: { "test:unit": "node --import tsx --test src/*.test.ts" }
    });
  });
  it("keeps op node:test files out of Vitest while retaining their maintained workspace task", () => {
    expect(rootUnitConfig.test?.exclude).toContain("packages/safe-bash-command-op/src/*.test.ts");
    const plan = createWorkspaceTestPlan(ROOT);
    expect(plan.testStages.filter(stage => stage.name === "safe-bash-command-op")).toEqual([
      { id: "safe-bash-command-op#test:unit", name: "safe-bash-command-op", path: "packages/safe-bash-command-op", event: "test:unit" }
    ]);
    expect(readJson(path.join(PACKAGES_DIR, "safe-bash-command-op", "package.json"))).toMatchObject({
      scripts: { "test:unit": "node --import tsx --test src/*.test.ts" }
    });
  });

  it("runs fold node:test suites through their maintained workspace task", () => {
    expect(rootUnitConfig.test?.exclude).toContain("packages/safe-bash-command-fold/src/*.test.ts");
    const plan = createWorkspaceTestPlan(ROOT);
    expect(plan.testStages.filter(stage => stage.name === "safe-bash-command-fold")).toEqual([
      { id: "safe-bash-command-fold#test:unit", name: "safe-bash-command-fold", path: "packages/safe-bash-command-fold", event: "test:unit" }
    ]);
    expect(readJson(path.join(PACKAGES_DIR, "safe-bash-command-fold", "package.json"))).toMatchObject({
      scripts: { "test:unit": "node --import tsx --test src/*.test.ts" }
    });
  });

  it("runs htmlq node:test suites only through the maintained private workspace task", () => {
    expect(rootUnitConfig.test?.exclude).toContain("packages/safe-bash-command-htmlq/src/*.test.ts");
    const plan = createWorkspaceTestPlan(ROOT);
    expect(plan.testStages.filter(stage => stage.name === "safe-bash-command-htmlq")).toEqual([
      { id: "safe-bash-command-htmlq#test:unit", name: "safe-bash-command-htmlq", path: "packages/safe-bash-command-htmlq", event: "test:unit" }
    ]);
    expect(readJson(path.join(PACKAGES_DIR, "safe-bash-command-htmlq", "package.json"))).toMatchObject({
      scripts: { "test:unit": "node --import tsx --test src/*.test.ts" }
    });
  });

  it("all packages with tests are listed in root dependencies", () => {
    const rootPkg = readJson(path.join(ROOT, "package.json")) as {
      dependencies: Record<string, string>;
      devDependencies: Record<string, string>;
    };
    const rootDeps = new Set([...Object.keys(rootPkg.dependencies), ...Object.keys(rootPkg.devDependencies)]);
    const packagesWithTests = getWorkspacePackagesWithTests();
    const missing = packagesWithTests.filter((name) => !rootDeps.has(name));

    expect(missing, [
      "These workspace packages have test files but are not in root dependencies.",
      "Turbo's ^build for //#test:unit only builds packages listed as root dependencies.",
      "Add them to devDependencies in the root package.json:",
      ...missing.map((name) => `  "${name}": "*"`)
    ].join("\n")).toEqual([]);
  });
});
