#!/usr/bin/env node
import { runCLI } from "toolcraft/cli";
import { codeReviewGroup } from "./cli.js";
import { parseCodeReviewAgentMcpArgs, runCodeReviewAgentMcp } from "./mcp.js";

const invokedArgs = process.argv.slice(2);
const args = invokedArgs[0] === "code-review" ? invokedArgs.slice(1) : invokedArgs;
const [command] = args;

if (command === "agent-mcp" && !args.includes("--help") && !args.includes("-h")) {
  await runCodeReviewAgentMcp(parseCodeReviewAgentMcpArgs(args.slice(1)));
} else {
  if (args !== invokedArgs) {
    process.argv.splice(2, process.argv.length - 2, ...args);
  }
  await runCLI(codeReviewGroup, { version: "0.1.0", presets: true });
}
