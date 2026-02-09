import fs from "node:fs";
import path from "node:path";

function readJsonFile<T>(filePath: string): T {
  const raw = fs.readFileSync(filePath, "utf8");
  return JSON.parse(raw) as T;
}

describe("US-017 bundled templates", () => {
  const repoRoot = path.resolve(__dirname, "../..");
  const ralphDir = path.join(repoRoot, "packages/ralph");
  const ralphPackageJsonPath = path.join(ralphDir, "package.json");
  const templatesDir = path.join(ralphDir, "templates");

  it("includes the template files in the workspace", () => {
    const requiredFiles = [
      path.join("references", "GUARDRAILS.md"),
      path.join("references", "CONTEXT_ENGINEERING.md"),
      path.join(".poe-code-ralph", "progress.md"),
      path.join(".poe-code-ralph", "guardrails.md"),
      path.join(".poe-code-ralph", "errors.log"),
      path.join(".poe-code-ralph", "activity.log")
    ].map(filePath => path.join(templatesDir, filePath));

    expect(fs.existsSync(templatesDir)).toBe(true);
    for (const filePath of requiredFiles) {
      expect(fs.existsSync(filePath)).toBe(true);
    }
  });

  it("includes templates in the package files array", () => {
    const pkg = readJsonFile<{ files?: string[] }>(ralphPackageJsonPath);
    expect(pkg.files).toBeDefined();
    expect(pkg.files).toContain("dist");
    expect(pkg.files).toContain("templates");
  });
});

