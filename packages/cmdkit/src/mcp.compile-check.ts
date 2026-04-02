import { S } from "@poe-code/cmdkit-schema";
import { defineCommand, defineGroup } from "./index.js";
import { createMCPServer, runMCP } from "./mcp.js";
import type { RunMCPOptions } from "./mcp.js";

type AssertAssignable<To, ignoredFrom extends To> = true;

const ignoredRoot = defineGroup({
  name: "root",
  children: [
    defineCommand({
      name: "usage",
      scope: ["mcp"],
      params: S.Object({
        dryRun: S.Boolean(),
      }),
      handler: async ({ params }) => params,
    }),
  ],
});

const ignoredOptions = {
  name: "cmdkit-test",
  version: "1.0.0",
  tools: ["usage"],
  casing: "snake",
} satisfies RunMCPOptions;

const ignoredServer = createMCPServer(ignoredRoot, ignoredOptions);
const ignoredRun = runMCP(ignoredRoot, ignoredOptions);

type ignoredOptionsExport = AssertAssignable<
  RunMCPOptions,
  typeof ignoredOptions
>;
type ignoredServerExport = AssertAssignable<object, typeof ignoredServer>;
type ignoredRunExport = AssertAssignable<Promise<void>, typeof ignoredRun>;
