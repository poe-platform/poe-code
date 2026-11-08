import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(import.meta.dirname, "..");
const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("npm installation preserves user skills", () => {
  it("neither restores deleted skills nor overwrites existing ones on install or ci", async () => {
    await mkdir(path.join(repoRoot, "out"), { recursive: true });
    const fixture = await mkdtemp(path.join(repoRoot, "out/install-skills-"));
    tempDirs.push(fixture);
    const home = path.join(fixture, "home");
    const existing = path.join(home, ".agents/skills/poe-code-plan/SKILL.md");
    const deleted = path.join(home, ".agents/skills/poe-code-pipeline-plan");
    await mkdir(path.dirname(existing), { recursive: true });
    await writeFile(existing, "My customized skill.\n");
    const manifest = JSON.parse(await readFile(path.join(repoRoot, "package.json"), "utf8"));
    const scripts = Object.fromEntries(Object.entries(manifest.scripts).filter(([name]) =>
      ["preinstall", "install", "postinstall"].includes(name))
      .map(([name, command]) => [name, (command as string).replaceAll("scripts/", `${repoRoot}/scripts/`)]));
    await writeFile(path.join(fixture, "package.json"), JSON.stringify({
      name: "poe-code-install-fixture", version: "0.0.0", type: "module", scripts
    }));

    for (const command of ["install", "ci"]) {
      await execFileAsync("npm", [command, "--no-audit", "--fund=false"], {
        cwd: fixture,
        env: { ...process.env, HOME: home, TMPDIR: fixture, npm_config_cache: path.join(fixture, "cache"), CI: "", SKIP_SYNC_SKILLS: "" }
      });
      await expect(readFile(existing, "utf8")).resolves.toBe("My customized skill.\n");
      await expect(stat(deleted)).rejects.toMatchObject({ code: "ENOENT" });
      await expect(stat(path.join(home, ".codex/skills"))).rejects.toMatchObject({ code: "ENOENT" });
    }
  });
});
