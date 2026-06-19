import { S } from "toolcraft-schema";
import { defineCommand, defineGroup } from "./index.js";
import { runCLI } from "./cli.js";
import type { RunCLIOptions } from "./cli.js";

const ignoredCommand = defineCommand({
  name: "deploy",
  params: S.Object({
    name: S.String(),
  }),
  handler: async () => null,
});

const ignoredRoot = defineGroup({
  name: "root",
  children: [ignoredCommand],
});

const ignoredOptions: RunCLIOptions<Record<string, never>> = {
  approvals: true,
  casing: "kebab",
  fetch: globalThis.fetch,
  controls: {
    debug: true,
    logLevel: true,
    output: true,
    verbose: true,
    yes: true,
  },
  logLevel: "warn",
  logger: (event) => {
    event.level satisfies "error" | "warn" | "info" | "debug" | "trace";
  },
  humanInLoop: {},
  version: "1.0.0",
};

const ignoredServiceOptions: RunCLIOptions<{ marker: string }> = {
  services: {
    marker: "value",
  },
};

void runCLI(ignoredRoot, ignoredOptions);
void runCLI([ignoredRoot], ignoredOptions);
void ignoredServiceOptions;
