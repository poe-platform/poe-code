#!/usr/bin/env node
import { createProgram } from "./cli/program.js";
import { createCliMain, isCliInvocation } from "./cli/bootstrap.js";

// SDK exports
export { spawn } from "./sdk/spawn.js";
export { getPoeApiKey } from "./sdk/credentials.js";
export type { SpawnOptions, SpawnResult } from "./sdk/types.js";

const main = createCliMain(createProgram);

if (isCliInvocation(process.argv, import.meta.url)) {
  void main();
}

// CLI exports
export { main, isCliInvocation };
