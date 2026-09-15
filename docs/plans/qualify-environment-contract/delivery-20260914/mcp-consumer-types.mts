import { makeMcpModule, type McpModuleOptions } from "@poe-platform/safe-js";
import type { SpawnOptions, ChildProcessWithoutNullStreams } from "node:child_process";
const fetch: NonNullable<McpModuleOptions["fetch"]> = async (_input: string | URL, _init?: RequestInit) => new Response(null);
const spawn: NonNullable<McpModuleOptions["spawn"]> = (_command: string, _args: readonly string[], _options: SpawnOptions) => ({}) as ChildProcessWithoutNullStreams;
makeMcpModule({servers:{memory:{url:"https://example.test/mcp"}},fetch,spawn});
// Source-module resolver mode is not part of this published public contract.
import { run } from "@poe-platform/safe-js/core";
// @ts-expect-error No public sourceType option in this delivered SDK.
run("export const value=1", {sourceType:"module"});
