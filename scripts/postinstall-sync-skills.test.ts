import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(import.meta.dirname, "..");
const postinstallScript = path.join(repoRoot, "scripts/postinstall-sync-skills.mjs");

const tempDirs: string[] = [];

async function createTempHome(): Promise<string> {
  const home = await mkdtemp(path.join(tmpdir(), "poe-code-skills-home-"));
  tempDirs.push(home);
  return home;
}

async function runPostinstall(env: NodeJS.ProcessEnv = {}) {
  return execFileAsync(process.execPath, [postinstallScript], {
    cwd: repoRoot,
    env: {
      ...process.env,
      HOME: await createTempHome(),
      CI: "",
      SKIP_SYNC_SKILLS: "",
      ...env
    }
  });
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await stat(target);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("postinstall skill sync", () => {
  it("does not write skill files when CI=1", async () => {
    const home = await createTempHome();

    await execFileAsync(process.execPath, [postinstallScript], {
      cwd: repoRoot,
      env: { ...process.env, HOME: home, CI: "1" }
    });

    await expect(
      pathExists(path.join(home, ".claude/skills/poe-code-plan/SKILL.md"))
    ).resolves.toBe(false);
  });

  it("does not write skill files when SKIP_SYNC_SKILLS=1", async () => {
    const home = await createTempHome();

    await execFileAsync(process.execPath, [postinstallScript], {
      cwd: repoRoot,
      env: { ...process.env, HOME: home, SKIP_SYNC_SKILLS: "1" }
    });

    await expect(
      pathExists(path.join(home, ".claude/skills/poe-code-plan/SKILL.md"))
    ).resolves.toBe(false);
  });

  it("writes expected global skill files", async () => {
    const home = await createTempHome();

    await execFileAsync(process.execPath, [postinstallScript], {
      cwd: repoRoot,
      env: { ...process.env, HOME: home, CI: "", SKIP_SYNC_SKILLS: "" }
    });

    const content = await readFile(
      path.join(home, ".claude/skills/poe-code-plan/SKILL.md"),
      "utf8"
    );
    expect(content).toContain("name: poe-code-plan");
    await expect(
      pathExists(path.join(home, ".codex/skills/poe-code-pipeline-plan/SKILL.md"))
    ).resolves.toBe(true);
    await expect(
      pathExists(path.join(home, ".config/opencode/skills/poe-code-plan/SKILL.md"))
    ).resolves.toBe(true);
    await expect(
      pathExists(path.join(home, ".agents/skills/poe-code-plan/SKILL.md"))
    ).resolves.toBe(true);
  });

  it("is idempotent when skill files already exist", async () => {
    const home = await createTempHome();
    const env = { ...process.env, HOME: home, CI: "", SKIP_SYNC_SKILLS: "" };

    await execFileAsync(process.execPath, [postinstallScript], { cwd: repoRoot, env });
    await execFileAsync(process.execPath, [postinstallScript], { cwd: repoRoot, env });

    const content = await readFile(
      path.join(home, ".claude/skills/poe-code-plan/SKILL.md"),
      "utf8"
    );
    expect(content).toContain("name: poe-code-plan");
  });

  it("warns and exits successfully when sync-skills fails", async () => {
    const failingNpm = path.join(await createTempHome(), "failing-npm.js");
    await writeFile(failingNpm, "process.exit(42);\n", "utf8");

    const result = await runPostinstall({ npm_execpath: failingNpm });

    expect(result.stderr).toContain("Warning: skill sync failed during postinstall");
  });
});
