#!/usr/bin/env node
import { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { applyPoeTheme } from "./cli/poe-theme.js";

async function main(): Promise<void> {
  const [{ createProgram }, { createCliMain }] = await Promise.all([
    import("./cli/program.js"),
    import("./cli/bootstrap.js")
  ]);

  applyPoeTheme();
  const runCli = createCliMain(createProgram);
  await runCli();
}

function isCliInvocation(
  argv: string[],
  moduleUrl: string,
  realpath: (path: string) => string = realpathSync
): boolean {
  const entry = argv.at(1);
  if (typeof entry !== "string") {
    return false;
  }

  const candidates = [pathToFileURL(entry).href];

  try {
    candidates.push(pathToFileURL(realpath(entry)).href);
  } catch {
    // Ignore resolution errors; fall back to direct comparison.
  }

  return candidates.includes(moduleUrl);
}

if (isCliInvocation(process.argv, import.meta.url)) {
  void main();
}


export { main, isCliInvocation };
