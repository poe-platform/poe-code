import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(import.meta.dirname, "..");
const postinstallScript = path.join(repoRoot, "scripts/postinstall-sync-skills.mjs");
const tempDirs: string[] = [];

async function createTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("postinstall skill sync lifecycle", () => {
  it("runs during npm install in a fresh clone", async () => {
    const cloneDir = await createTempDir("poe-code-fresh-clone-");
    const home = await createTempDir("poe-code-skills-home-");

    await mkdir(path.join(cloneDir, "scripts"), { recursive: true });
    await writeFile(
      path.join(cloneDir, "package.json"),
      JSON.stringify(
        {
          name: "poe-code-fresh-clone-fixture",
          version: "0.0.0",
          type: "module",
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
    await writeFile(path.join(cloneDir, "scripts/sync-skills.ts"), "", "utf8");
    await writeFile(
      path.join(cloneDir, "scripts/sync-skills.js"),
      [
        'import { mkdirSync, writeFileSync } from "node:fs";',
        'import { join } from "node:path";',
        'const skillDir = join(process.env.HOME, ".claude/skills/poe-code-plan");',
        "mkdirSync(skillDir, { recursive: true });",
        'writeFileSync(join(skillDir, "SKILL.md"), "---\\nname: poe-code-plan\\n---\\n", "utf8");'
      ].join("\n"),
      "utf8"
    );

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
});
