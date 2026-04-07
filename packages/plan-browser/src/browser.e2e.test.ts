import { afterEach, describe, expect, it } from "vitest";
import { access, mkdtemp, mkdir, rm, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { TerminalPilot } from "@poe-code/terminal-pilot";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const tsxPath = path.join(repoRoot, "node_modules", ".bin", "tsx");
const registerLoaderPath = path.join(repoRoot, "scripts", "register-hbs-loader.mjs");
const cliEntryPath = path.join(repoRoot, "src", "index.ts");

const pilots: TerminalPilot[] = [];
const tempDirs: string[] = [];

async function waitForCondition(
  condition: () => Promise<boolean>,
  timeoutMs = 5_000
): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (await condition()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  throw new Error("Timed out waiting for condition.");
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function createFixture(): Promise<{ projectDir: string; homeDir: string }> {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "plan-browser-"));
  tempDirs.push(rootDir);

  const projectDir = path.join(rootDir, "project");
  const homeDir = path.join(rootDir, "home");

  await mkdir(path.join(projectDir, ".poe-code", "pipeline", "plans"), { recursive: true });
  await mkdir(path.join(projectDir, ".poe-code", "ralph", "plans"), { recursive: true });
  await mkdir(path.join(projectDir, ".poe-code", "experiments"), { recursive: true });
  await mkdir(homeDir, { recursive: true });

  await writeFile(
    path.join(projectDir, ".poe-code", "pipeline", "plans", "plan-feature.yaml"),
    [
      "tasks:",
      "  - id: feature",
      "    title: Add feature",
      "    prompt: Ship the feature",
      "    status: open",
      ""
    ].join("\n")
  );
  await writeFile(
    path.join(projectDir, ".poe-code", "ralph", "plans", "spawn-hooks.md"),
    [
      "---",
      "agent: claude-code",
      "iterations: 3",
      "status:",
      "  state: in_progress",
      "  iteration: 2",
      "---",
      "# Spawn hooks",
      "",
      "Refine the spawn hooks flow."
    ].join("\n")
  );
  await writeFile(
    path.join(projectDir, ".poe-code", "experiments", "speed-up-tests.md"),
    [
      "---",
      "agent: claude-code",
      "metric:",
      "  name: test_duration",
      "  script: npm run metric:test_duration",
      "  direction: minimize",
      "baseline: null",
      "---",
      "# Speed up tests",
      "",
      "Reduce total test runtime."
    ].join("\n")
  );

  const baseTime = Date.UTC(2026, 3, 7, 12, 0, 0) / 1000;
  await utimes(
    path.join(projectDir, ".poe-code", "pipeline", "plans", "plan-feature.yaml"),
    baseTime - 20,
    baseTime - 20
  );
  await utimes(
    path.join(projectDir, ".poe-code", "ralph", "plans", "spawn-hooks.md"),
    baseTime - 10,
    baseTime - 10
  );
  await utimes(
    path.join(projectDir, ".poe-code", "experiments", "speed-up-tests.md"),
    baseTime,
    baseTime
  );

  return { projectDir, homeDir };
}

function createSessionEnv(homeDir: string): Record<string, string> {
  const passthroughKeys = [
    "PATH",
    "SHELL",
    "TERM",
    "LANG",
    "LC_ALL",
    "TMPDIR",
    "TMP",
    "TEMP",
    "COLORTERM",
    "SystemRoot",
    "ComSpec",
    "PATHEXT",
    "WINDIR"
  ] as const;

  const env: Record<string, string> = {};
  for (const key of passthroughKeys) {
    const value = process.env[key];
    if (value) {
      env[key] = value;
    }
  }

  return {
    ...env,
    HOME: homeDir,
    EDITOR: "cat",
    POE_NO_SPINNER: "1",
    FORCE_COLOR: "0"
  };
}

async function launchPlanBrowser(args: string[], fixture: { projectDir: string; homeDir: string }) {
  const pilot = await TerminalPilot.launch();
  pilots.push(pilot);

  return pilot.newSession({
    command: tsxPath,
    args: ["--import", registerLoaderPath, cliEntryPath, ...args],
    cwd: fixture.projectDir,
    env: createSessionEnv(fixture.homeDir),
    cols: 120,
    rows: 40
  });
}

afterEach(async () => {
  await Promise.all(
    pilots.splice(0).map(async (pilot) => {
      await pilot.close();
    })
  );

  await Promise.all(
    tempDirs.splice(0).map(async (dir) => {
      await rm(dir, { recursive: true, force: true });
    })
  );
});

describe("plan browser", { timeout: 20_000 }, () => {
  it("browses to preview and returns to the list", async () => {
    const fixture = await createFixture();
    const session = await launchPlanBrowser(["plan"], fixture);

    await session.waitFor("Select a plan");
    await session.press("Enter");
    await session.waitFor("Action");
    await session.press("Escape");
    await session.waitFor("Select a plan");
  });

  it("exits from the list with escape", async () => {
    const fixture = await createFixture();
    const session = await launchPlanBrowser(["plan"], fixture);

    await session.waitFor("Select a plan");
    await session.press("Escape");
    await expect(session.waitForExit({ timeout: 5_000 })).resolves.toBe(0);
  });

  it("archives a selected plan and refreshes the list", async () => {
    const fixture = await createFixture();
    const session = await launchPlanBrowser(["plan"], fixture);

    await session.waitFor("Select a plan");
    await session.press("ArrowDown");
    await session.press("Enter");
    await session.waitFor("Action");
    await session.press("ArrowDown");
    await session.press("ArrowDown");
    await session.press("Enter");
    await session.waitFor("Archive spawn-hooks.md?");
    await session.press("Enter");

    const archivedPath = path.join(
      fixture.projectDir,
      ".poe-code",
      "ralph",
      "plans",
      "archive",
      "spawn-hooks.md"
    );
    await waitForCondition(() => pathExists(archivedPath));
    await expect(access(archivedPath)).resolves.toBeUndefined();
  });

  it("deletes a selected plan and refreshes the list", async () => {
    const fixture = await createFixture();
    const session = await launchPlanBrowser(["plan"], fixture);

    await session.waitFor("Select a plan");
    await session.press("Enter");
    await session.waitFor("Action");
    await session.press("ArrowDown");
    await session.press("ArrowDown");
    await session.press("ArrowDown");
    await session.press("Enter");
    await session.waitFor("Permanently delete");
    await session.press("Enter");

    const deletedPath = path.join(
      fixture.projectDir,
      ".poe-code",
      "experiments",
      "speed-up-tests.md"
    );
    await waitForCondition(async () => !(await pathExists(deletedPath)));
    await expect(access(deletedPath)).rejects.toThrow();
  });

  it("opens the editor and returns to the list", async () => {
    const fixture = await createFixture();
    const session = await launchPlanBrowser(["plan"], fixture);

    await session.waitFor("Select a plan");
    await session.press("Enter");
    await session.waitFor("Action");
    await session.press("ArrowDown");
    await session.press("Enter");
    await session.waitFor("Select a plan");
  });

  it("filters the list by source", async () => {
    const fixture = await createFixture();
    const session = await launchPlanBrowser(["plan", "--source", "pipeline"], fixture);

    await session.waitFor("Select a plan");
    const screen = await session.screen();
    expect(screen.text).toContain("plan-feature.yaml");
    expect(screen.text).not.toContain("spawn-hooks.md");
    expect(screen.text).not.toContain("speed-up-tests.md");
  });

  it("with --yes previews the first plan and exits without prompting", async () => {
    const fixture = await createFixture();
    const session = await launchPlanBrowser(["--yes", "plan"], fixture);

    await session.waitFor("Speed up tests");
    const screen = await session.screen();
    expect(screen.text).toContain("Speed up tests");
    expect(screen.text).not.toContain("Select a plan");
    await expect(session.waitForExit({ timeout: 5_000 })).resolves.toBe(0);
  });
});
