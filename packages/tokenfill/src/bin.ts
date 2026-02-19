#!/usr/bin/env node
import { runCli } from "./cli.js";

const exitCode = await runCli();

if (exitCode !== 0) {
  process.exit(exitCode);
}
