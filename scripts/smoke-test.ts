import { execSync, spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
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
  "poe-code models --help",
  "poe-code usage --help",
  "poe-code configure claude-code --yes --dry-run --verbose",
  "poe-code configure codex --yes --dry-run --verbose",
  "poe-code configure opencode --yes --dry-run --verbose",
  "poe-code configure kimi --yes --dry-run --verbose",
  "poe-code unconfigure claude-code --dry-run --verbose",
  "poe-code spawn claude-code 'hello' --mode yolo --dry-run --verbose",
  "poe-code login --dry-run",
  "poe-code install --yes --dry-run --verbose",
  "poe-code github-workflows --help",
  "poe-code github-workflows list",
  "poe-code github-workflows prompt-preview github-issue-opened",
  "poe-code github-workflows prompt-preview fix-vulnerabilities",
];
// ─────────────────────────────────────────────────────────────

const program = new Command()
  .description("Run smoke tests against the packed CLI")
  .option("--verbose", "Show command output")
  .parse();

const verbose = program.opts().verbose as boolean;

type InstallContext = {
  packageDir: string;
  sdkProjectDir: string;
};

function install(): InstallContext {
  const tmpDir = mkdtempSync(path.join(os.tmpdir(), "poe-smoke-"));
  console.log("Packing and installing globally...");
  execSync(`npm pack --pack-destination "${tmpDir}" --silent`, {
    stdio: "pipe",
  });
  const tgz = readdirSync(tmpDir).find((f) => f.endsWith(".tgz"));
  if (!tgz) {
    throw new Error("Failed to locate packed tarball.");
  }

  const packagePath = path.join(tmpDir, tgz);
  execSync(`npm install -g "${packagePath}"`, { stdio: "pipe" });

  const sdkProjectDir = mkdtempSync(path.join(os.tmpdir(), "poe-smoke-sdk-"));
  execSync("npm init -y", { cwd: sdkProjectDir, stdio: "pipe" });
  execSync(`npm install "${packagePath}" --silent`, {
    cwd: sdkProjectDir,
    stdio: "pipe",
  });

  return { packageDir: tmpDir, sdkProjectDir };
}

function cleanup(context: InstallContext) {
  try {
    execSync("npm uninstall -g poe-code", { stdio: "pipe" });
  } catch {
    if (verbose) {
      console.log("Cleanup warning: npm uninstall failed.");
    }
  }
  rmSync(context.packageDir, { recursive: true, force: true });
  rmSync(context.sdkProjectDir, { recursive: true, force: true });
}

function run(): boolean {
  let failed = false;

  for (const cmd of COMMANDS) {
    const result = spawnSync(cmd, {
      shell: true,
      encoding: "utf-8",
      timeout: 30_000,
      env: { ...process.env, POE_CODE_OAUTH_LOGIN: "0" },
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

function runSdkImportSmoke(sdkProjectDir: string): boolean {
  const scriptPath = path.join(sdkProjectDir, "sdk-smoke.mjs");
  writeFileSync(
    scriptPath,
    [
      'import { getPoeApiKey, spawn } from "poe-code";',
      'if (typeof spawn !== "function") {',
      '  throw new Error("Expected spawn export to be a function.");',
      "}",
      "const key = await getPoeApiKey();",
      'if (key !== "smoke-test-key") {',
      "  throw new Error(`Unexpected API key: ${key}`);",
      "}",
      "",
    ].join("\n"),
    "utf8",
  );

  const label = "poe-code sdk import smoke";
  const result = spawnSync(process.execPath, [scriptPath], {
    cwd: sdkProjectDir,
    encoding: "utf-8",
    timeout: 30_000,
    env: {
      ...process.env,
      POE_API_KEY: "smoke-test-key",
    },
  });

  const output = (result.stdout || "") + (result.stderr || "");
  const passed = result.status === 0;

  if (passed) {
    console.log(`  \u2713 ${label}`);
  } else {
    console.log(`  \u2717 ${label} (exit ${result.status})`);
  }

  if (verbose || !passed) {
    const lines = output.trimEnd().split("\n");
    for (const line of lines) {
      console.log(`    \u2502 ${line}`);
    }
    console.log();
  }

  return passed;
}

function runCredentialsImportSmoke(sdkProjectDir: string): boolean {
  const scriptPath = path.join(sdkProjectDir, "credentials-smoke.mjs");
  writeFileSync(
    scriptPath,
    [
      'import { getPoeApiKey } from "poe-code/credentials";',
      "const key = await getPoeApiKey();",
      'if (key !== "smoke-test-key") {',
      "  throw new Error(`Unexpected API key: ${key}`);",
      "}",
      "",
    ].join("\n"),
    "utf8",
  );

  const label = "poe-code credentials import smoke";
  const result = spawnSync(process.execPath, [scriptPath], {
    cwd: sdkProjectDir,
    encoding: "utf-8",
    timeout: 30_000,
    env: {
      ...process.env,
      POE_API_KEY: "smoke-test-key",
    },
  });

  const output = (result.stdout || "") + (result.stderr || "");
  const passed = result.status === 0 && output.length === 0;

  if (passed) {
    console.log(`  \u2713 ${label}`);
  } else {
    console.log(`  \u2717 ${label} (exit ${result.status})`);
  }

  if (verbose || !passed) {
    const lines = output.trimEnd().split("\n");
    for (const line of lines) {
      console.log(`    \u2502 ${line}`);
    }
    console.log();
  }

  return passed;
}

function runConfigImportSmoke(sdkProjectDir: string): boolean {
  const scriptPath = path.join(sdkProjectDir, "config-smoke.mjs");
  writeFileSync(
    scriptPath,
    [
      'import { createConfigStore } from "poe-code/config";',
      'import { createMockFs } from "poe-code/config/testing";',
      'if (typeof createConfigStore !== "function" || typeof createMockFs !== "function") {',
      '  throw new Error("Expected released config APIs to be functions.");',
      "}",
      "",
    ].join("\n"),
    "utf8",
  );

  const label = "poe-code config import smoke";
  const result = spawnSync(process.execPath, [scriptPath], {
    cwd: sdkProjectDir,
    encoding: "utf-8",
    timeout: 30_000,
  });
  const output = (result.stdout || "") + (result.stderr || "");
  const passed = result.status === 0 && output.length === 0;

  console.log(passed ? `  \u2713 ${label}` : `  \u2717 ${label} (exit ${result.status})`);
  if (verbose || !passed) {
    for (const line of output.trimEnd().split("\n")) {
      console.log(`    \u2502 ${line}`);
    }
    console.log();
  }
  return passed;
}

const installContext = install();
try {
  const ok =
    run() &&
    runSdkImportSmoke(installContext.sdkProjectDir) &&
    runCredentialsImportSmoke(installContext.sdkProjectDir) &&
    runConfigImportSmoke(installContext.sdkProjectDir);
  if (ok) {
    console.log("\nAll smoke tests passed.");
  } else {
    console.log("\nSmoke tests failed!");
    process.exitCode = 1;
  }
} finally {
  cleanup(installContext);
}
