#!/usr/bin/env node
import { Command } from "commander";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { access } from "node:fs/promises";
import { createRequire } from "node:module";
import {
  createEncryptServer,
  createWordOfTheDayServer,
} from "./index.js";
import {
  getNextSpawnCount,
  isServeToolName,
  SERVE_TOOL_NAMES,
  type ServeToolName,
} from "./cli-support.js";

// createRequire instead of JSON import attributes: `with { type: "json" }` is a
// syntax error before Node 18.20, and engines declares >=18.18 (#517).
const require = createRequire(import.meta.url);
const packageJson = require("../package.json") as { version: string };

const program = new Command();

program
  .name("tiny-stdio-mcp-test-server")
  .description("Test MCP server with example tools for integration testing")
  .version(packageJson.version);

program
  .command("serve")
  .description("Start an MCP server on stdin/stdout")
  .argument("<tool>", "Tool to serve (encrypt, word-of-the-day)")
  .action(async (tool: string) => {
    if (!isServeToolName(tool)) {
      console.error(`Unknown tool: ${tool}. Available: ${SERVE_TOOL_NAMES.join(", ")}`);
      process.exit(1);
    }

    try {
      recordProcessStart();
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    }

    const startupDelayMs = Number(process.env.TOOLCRAFT_TEST_STARTUP_DELAY_MS ?? "0");
    if (startupDelayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, startupDelayMs));
    }
    const startupGateFile = process.env.TOOLCRAFT_TEST_STARTUP_GATE_FILE;
    if (startupGateFile !== undefined) {
      await waitForFile(startupGateFile);
    }
    const servers: Record<ServeToolName, () => Promise<void>> = Object.create(null) as Record<ServeToolName, () => Promise<void>>;
    Object.assign(servers, {
      encrypt: () => createEncryptServer().listen(),
      "word-of-the-day": () => createWordOfTheDayServer().listen(),
    });

    await servers[tool]();
  });

program.parse();

function recordProcessStart(): void {
  const countFile = process.env.TOOLCRAFT_TEST_SPAWN_COUNT_FILE;
  if (countFile !== undefined) {
    const currentValue = existsSync(countFile)
      ? readFileSync(countFile, "utf8")
      : undefined;
    writeFileSync(countFile, String(getNextSpawnCount(currentValue)));
  }

  const pidFile = process.env.TOOLCRAFT_TEST_WRAPPER_PID_FILE;
  if (pidFile !== undefined) {
    writeFileSync(pidFile, String(process.pid));
  }
}

async function waitForFile(filePath: string): Promise<void> {
  while (true) {
    try {
      await access(filePath);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  }
}
