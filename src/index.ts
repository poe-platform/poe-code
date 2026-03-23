#!/usr/bin/env node
import { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";

// SDK exports
export { spawn } from "./sdk/spawn.js";
export { runPipeline } from "./sdk/pipeline.js";
export { runRalph } from "./sdk/ralph.js";
export { generate, generateImage, generateVideo, generateAudio } from "./sdk/generate.js";
export { getPoeApiKey } from "./sdk/credentials.js";
export type {
  SpawnOptions,
  SpawnUsage,
  SpawnResult,
  GenerateOptions,
  MediaGenerateOptions,
  GenerateResult,
  MediaGenerateResult
} from "./sdk/types.js";
export type {
  PipelineRunOptions,
  PipelineRunResult
} from "./sdk/pipeline.js";
export type {
  RalphRunOptions,
  RalphRunResult
} from "./sdk/ralph.js";

async function main(): Promise<void> {
  const [{ createProgram }, { createCliMain }] = await Promise.all([
    import("./cli/program.js"),
    import("./cli/bootstrap.js")
  ]);

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

// CLI exports
export { main, isCliInvocation };
export { poeAgentMain } from "./cli/poe-agent-main.js";
