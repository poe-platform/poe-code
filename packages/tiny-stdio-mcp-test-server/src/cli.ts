#!/usr/bin/env node
import { Command } from "commander";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { access } from "node:fs/promises";
import packageJson from "../package.json" with { type: "json" };
import {
  createEncryptServer,
  createWordOfTheDayServer,
} from "./index.js";

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
    recordProcessStart();
    const startupDelayMs = Number(process.env.TOOLCRAFT_TEST_STARTUP_DELAY_MS ?? "0");
    if (startupDelayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, startupDelayMs));
    }
    const startupGateFile = process.env.TOOLCRAFT_TEST_STARTUP_GATE_FILE;
    if (startupGateFile !== undefined) {
      await waitForFile(startupGateFile);
    }
    const servers: Record<string, () => Promise<void>> = Object.create(null) as Record<string, () => Promise<void>>;
    Object.assign(servers, {
      encrypt: () => createEncryptServer().listen(),
      "word-of-the-day": () => createWordOfTheDayServer().listen(),
    });

    const start = servers[tool];
    if (!start) {
      const available = Object.keys(servers).join(", ");
      console.error(`Unknown tool: ${tool}. Available: ${available}`);
      process.exit(1);
    }

    await start();
  });

program.parse();

function recordProcessStart(): void {
  const countFile = process.env.TOOLCRAFT_TEST_SPAWN_COUNT_FILE;
  if (countFile !== undefined) {
    const previousCount = existsSync(countFile)
      ? Number.parseInt(readFileSync(countFile, "utf8").trim() || "0", 10)
      : 0;
    writeFileSync(countFile, String(previousCount + 1));
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
