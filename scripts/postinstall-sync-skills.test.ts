import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
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

async function createFreshCloneFixture(options: { syncScript?: string } = {}): Promise<{
  cloneDir: string;
  home: string;
}> {
  const cloneDir = await mkdtemp(path.join(tmpdir(), "poe-code-fresh-clone-"));
  const home = await createTempHome();
  tempDirs.push(cloneDir);

  await mkdir(path.join(cloneDir, "scripts"), { recursive: true });
  await writeFile(
    path.join(cloneDir, "package.json"),
    JSON.stringify(
      {
        name: "poe-code-fresh-clone-fixture",
        version: "0.0.0",
        scripts: {
          "sync-skills": "node scripts/sync-skills.js",
          postinstall: "node scripts/postinstall-sync-skills.mjs"
        }
      },
      null,
      2
    ),
    "utf8"
  );
  await writeFile(
    path.join(cloneDir, "scripts/postinstall-sync-skills.mjs"),
    await readFile(postinstallScript, "utf8"),
    "utf8"
  );
  await writeFile(
    path.join(cloneDir, "scripts/sync-skills.ts"),
    "",
    "utf8"
  );
  await writeFile(
    path.join(cloneDir, "scripts/sync-skills.js"),
    options.syncScript ??
      [
        'import { mkdirSync, writeFileSync } from "node:fs";',
        'import { join } from "node:path";',
        'const skillDir = join(process.env.HOME, ".claude/skills/poe-code-plan");',
        "mkdirSync(skillDir, { recursive: true });",
        'writeFileSync(join(skillDir, "SKILL.md"), "---\\nname: poe-code-plan\\n---\\n", "utf8");'
      ].join("\n"),
    "utf8"
  );

  return { cloneDir, home };
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("postinstall skill sync", () => {
  it("runs during npm install in a fresh clone", async () => {
    const { cloneDir, home } = await createFreshCloneFixture();

    await execFileAsync("npm", ["install", "--package-lock=false", "--no-audit", "--fund=false"], {
      cwd: cloneDir,
      env: { ...process.env, HOME: home, CI: "", SKIP_SYNC_SKILLS: "" }
    });

    const content = await readFile(
      path.join(home, ".claude/skills/poe-code-plan/SKILL.md"),
      "utf8"
    );
    expect(content).toContain("name: poe-code-plan");
  });

  it("does not fail npm install when the sync script fails", async () => {
    const { cloneDir, home } = await createFreshCloneFixture({
      syncScript: 'console.error("sync failed");\nprocess.exit(42);\n'
    });

    const result = await execFileAsync(
      "npm",
      ["install", "--package-lock=false", "--no-audit", "--fund=false"],
      {
        cwd: cloneDir,
        env: { ...process.env, HOME: home, CI: "", SKIP_SYNC_SKILLS: "" }
      }
    );

    expect(result.stderr).toContain("Warning: skill sync failed during postinstall");
    await expect(
      pathExists(path.join(home, ".claude/skills/poe-code-plan/SKILL.md"))
    ).resolves.toBe(false);
  });

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
    await expect(
      pathExists(path.join(home, ".gemini/skills/stop-slop/SKILL.md"))
    ).resolves.toBe(true);
    await expect(
      pathExists(path.join(repoRoot, ".claude/skills/gemini-cli/stop-slop/SKILL.md"))
    ).resolves.toBe(false);
  });

  it("is idempotent when skill files already exist", async () => {
    const home = await createTempHome();
    const env = { ...process.env, HOME: home, CI: "", SKIP_SYNC_SKILLS: "" };
    const skillDir = path.join(home, ".claude/skills/poe-code-plan");
    const skillFile = path.join(skillDir, "SKILL.md");
    const template = await readFile(
      path.join(repoRoot, "src/templates/plan/SKILL_plan.md"),
      "utf8"
    );

    await mkdir(skillDir, { recursive: true });
    await writeFile(skillFile, template, "utf8");
    await execFileAsync(process.execPath, [postinstallScript], { cwd: repoRoot, env });

    const content = await readFile(skillFile, "utf8");
    expect(content).toContain("name: poe-code-plan");
  });

  it("warns and exits successfully when sync-skills fails", async () => {
    const failingNpm = path.join(await createTempHome(), "failing-npm.js");
    await writeFile(failingNpm, "process.exit(42);\n", "utf8");

    const result = await runPostinstall({
      npm_execpath: failingNpm,
      POE_CODE_POSTINSTALL_FORCE_NPM: "1"
    });

    expect(result.stderr).toContain("Warning: skill sync failed during postinstall");
  });
});
