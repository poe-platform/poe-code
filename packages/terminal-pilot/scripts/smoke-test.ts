import { execSync, spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { Command } from "commander";

// ── Smoke test commands ──────────────────────────────────────
// Each entry is a command that must exit 0.
const COMMANDS = [
  "terminal-pilot --help",
];
// ─────────────────────────────────────────────────────────────

const program = new Command()
  .description("Run smoke tests against the packed terminal-pilot CLI")
  .option("--verbose", "Show command output")
  .parse();

const verbose = program.opts().verbose as boolean;

type InstallContext = {
  packageDir: string;
};

function install(): InstallContext {
  const tmpDir = mkdtempSync(path.join(os.tmpdir(), "tp-smoke-"));
  console.log("Packing and installing globally...");
  execSync(
    `npm pack --pack-destination "${tmpDir}" --silent`,
    { stdio: "pipe", cwd: path.resolve(import.meta.dirname, "..") }
  );
  const tgz = readdirSync(tmpDir).find((f) => f.endsWith(".tgz"));
  if (!tgz) {
    throw new Error("Failed to locate packed tarball.");
  }

  const packagePath = path.join(tmpDir, tgz);
  execSync(`npm install -g --force "${packagePath}"`, { stdio: "pipe" });

  return { packageDir: tmpDir };
}

function cleanup(context: InstallContext) {
  try {
    execSync("npm uninstall -g terminal-pilot", { stdio: "pipe" });
  } catch {
    if (verbose) {
      console.log("Cleanup warning: npm uninstall failed.");
    }
  }
  rmSync(context.packageDir, { recursive: true, force: true });
}

function run(): boolean {
  let failed = false;

  for (const cmd of COMMANDS) {
    const result = spawnSync(cmd, {
      shell: true,
      encoding: "utf-8",
      timeout: 30_000,
    });

    const output = (result.stdout || "") + (result.stderr || "");
    const passed = result.status === 0;

    if (passed) {
      console.log(`  \u2713 ${cmd}`);
    } else {
      console.log(`  \u2717 ${cmd} (exit ${result.status})`);
      failed = true;
    }

    if (verbose || !passed) {
      const lines = output.trimEnd().split("\n");
      for (const line of lines) {
        console.log(`    \u2502 ${line}`);
      }
      console.log();
    }
  }

  return !failed;
}

const installContext = install();
try {
  const ok = run();
  if (ok) {
    console.log("\nAll smoke tests passed.");
  } else {
    console.log("\nSmoke tests failed!");
    process.exitCode = 1;
  }
} finally {
  cleanup(installContext);
}
