#!/usr/bin/env node
import { Command } from "commander";
import {
  createEncryptServer,
  createWordOfTheDayServer,
} from "./index.js";

const program = new Command();

program
  .name("tiny-stdio-mcp-test-server")
  .description("Test MCP server with example tools for integration testing")
  .version("0.0.1");

program
  .command("serve")
  .description("Start an MCP server on stdin/stdout")
  .argument("<tool>", "Tool to serve (encrypt, word-of-the-day)")
  .action(async (tool: string) => {
    const servers: Record<string, () => Promise<void>> = {
      encrypt: () => createEncryptServer().listen(),
      "word-of-the-day": () => createWordOfTheDayServer().listen(),
    };

    const start = servers[tool];
    if (!start) {
      const available = Object.keys(servers).join(", ");
      console.error(`Unknown tool: ${tool}. Available: ${available}`);
      process.exit(1);
    }

    await start();
  });

program.parse();
