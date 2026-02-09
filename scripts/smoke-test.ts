import { execSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, readdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { Command } from "commander";

// ── Smoke test commands ──────────────────────────────────────
// Each entry is a command that must exit 0.
// Edit this list to add or remove smoke tests.
const COMMANDS = [
  "poe-code --version",
  "poe-code --help",
  "poe-code configure --help",
  "poe-code spawn --help",
  "poe-code generate --help",
  "poe-code mcp --help",
  "poe-code models --help",
  "poe-code usage --help",
  "poe-code configure claude-code --yes --dry-run --verbose",
  "poe-code configure codex --yes --dry-run --verbose",
  "poe-code configure opencode --yes --dry-run --verbose",
  "poe-code configure kimi --yes --dry-run --verbose",
  "poe-code unconfigure claude-code --dry-run --verbose",
  "poe-code spawn claude-code 'hello' --dry-run --verbose",
  "poe-code mcp configure --yes --dry-run --verbose",
  "poe-code login --dry-run",
  "poe-code install --dry-run",
];
// ─────────────────────────────────────────────────────────────

const program = new Command()
  .description("Run smoke tests against the packed CLI")
  .option("--verbose", "Show command output")
  .parse();

const verbose = program.opts().verbose as boolean;

function install(): string {
  const tmpDir = mkdtempSync(path.join(os.tmpdir(), "poe-smoke-"));
  console.log("Packing and installing globally...");
  execSync(`npm pack --pack-destination "${tmpDir}" --silent`, {
    stdio: "pipe",
  });
  const tgz = readdirSync(tmpDir).find((f) => f.endsWith(".tgz"));
  execSync(`npm install -g "${path.join(tmpDir, tgz!)}"`, { stdio: "pipe" });
  return tmpDir;
}

function cleanup(tmpDir: string) {
  try {
    execSync("npm uninstall -g poe-code", { stdio: "pipe" });
  } catch {
    if (verbose) {
      console.log("Cleanup warning: npm uninstall failed.");
    }
  }
  rmSync(tmpDir, { recursive: true, force: true });
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

const tmpDir = install();
try {
  const ok = run();
  if (ok) {
    console.log("\nAll smoke tests passed.");
  } else {
    console.log("\nSmoke tests failed!");
    process.exitCode = 1;
  }
} finally {
  cleanup(tmpDir);
}
