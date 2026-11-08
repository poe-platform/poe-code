import type {
  FileSystem,
  MutationObservers
} from "@poe-code/config-mutations";

export interface McpStdioServer {
  transport: "stdio";
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

export interface McpHttpServer {
  transport: "http";
  url: string;
  headers?: Record<string, string>;
}

export type McpServerConfig = McpStdioServer | McpHttpServer;

export interface McpServerEntry {
  name: string;
  config: McpServerConfig;
  enabled?: boolean;
}

export interface ApplyOptions {
  fs: FileSystem;
  homeDir: string;
  platform: "darwin" | "linux" | "win32";
  dryRun?: boolean;
  observers?: MutationObservers;
}
