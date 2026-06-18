import { S } from "toolcraft-schema";
import { defineCommand, defineGroup } from "./index.js";
import { createMCPServer, runMCP } from "./mcp.js";
import type { RunMCPOptions } from "./mcp.js";
import type { HumanInLoopRuntimeOptions } from "./index.js";

type AssertAssignable<To, ignoredFrom extends To> = true;

const ignoredRoot = defineGroup({
  name: "root",
  children: [
    defineCommand({
      name: "usage",
      scope: ["mcp"],
      params: S.Object({
        preview: S.Boolean(),
      }),
      handler: async ({ params }) => params,
    }),
  ],
});

const ignoredOptions = {
  approvals: false,
  name: "toolcraft-test",
  version: "1.0.0",
  fetch: globalThis.fetch,
  tools: ["usage"],
  casing: "snake",
  humanInLoop: {} satisfies HumanInLoopRuntimeOptions,
} satisfies RunMCPOptions;

const ignoredServer = createMCPServer(ignoredRoot, ignoredOptions);
const ignoredServerArray = createMCPServer([ignoredRoot], ignoredOptions);
const ignoredRun = runMCP(ignoredRoot, ignoredOptions);
const ignoredRunArray = runMCP([ignoredRoot], ignoredOptions);

type ignoredOptionsExport = AssertAssignable<
  RunMCPOptions,
  typeof ignoredOptions
>;
type ignoredServerExport = AssertAssignable<object, typeof ignoredServer>;
type ignoredServerArrayExport = AssertAssignable<object, typeof ignoredServerArray>;
type ignoredRunExport = AssertAssignable<Promise<void>, typeof ignoredRun>;
type ignoredRunArrayExport = AssertAssignable<Promise<void>, typeof ignoredRunArray>;
