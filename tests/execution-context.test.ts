import { describe, it, expect } from "vitest";
import {
  detectExecutionContext,
  toMcpServerCommand,
  toOpenCodeMcpCommand
} from "../src/utils/execution-context.js";

describe("detectExecutionContext", () => {
  const baseEnv: Record<string, string | undefined> = {};
  const moduleUrl = "file:///workspace/poe-code/src/index.ts";

  describe("development mode detection", () => {
    it("detects tsx execution via .ts extension in argv", () => {
      const result = detectExecutionContext({
        argv: ["/usr/bin/node", "/workspace/poe-code/src/index.ts", "mcp"],
        env: baseEnv,
        moduleUrl
      });

      expect(result.mode).toBe("development");
      expect(result.command.command).toBe("npm");
      expect(result.command.args).toEqual(["--silent", "--prefix", "/workspace/poe-code", "run", "dev", "--"]);
    });

    it("detects npm run dev via lifecycle event", () => {
      const result = detectExecutionContext({
        argv: ["/usr/bin/node", "/workspace/poe-code/dist/index.js", "mcp"],
        env: { npm_lifecycle_event: "dev" },
        moduleUrl
      });

      expect(result.mode).toBe("development");
    });

    it("detects tsx loader via NODE_OPTIONS", () => {
      const result = detectExecutionContext({
        argv: ["/usr/bin/node", "/workspace/poe-code/dist/index.js", "mcp"],
        env: { NODE_OPTIONS: "--import tsx/esm" },
        moduleUrl
      });

      expect(result.mode).toBe("development");
    });
  });

  describe("npx execution detection", () => {
    it("detects basic npx execution", () => {
      const result = detectExecutionContext({
        argv: ["/usr/bin/node", "/home/user/.npm/_npx/12345/node_modules/.bin/poe-code", "mcp"],
        env: {
          npm_command: "exec",
          npm_execpath: "/usr/lib/node_modules/npm/bin/npx-cli.js"
        },
        moduleUrl
      });

      expect(result.mode).toBe("npx");
      expect(result.command.command).toBe("npx");
      expect(result.command.args).toEqual(["--yes", "poe-code"]);
    });

    it("detects npx@beta execution", () => {
      const result = detectExecutionContext({
        argv: ["/usr/bin/node", "/home/user/.npm/_npx/12345/node_modules/.bin/poe-code", "mcp"],
        env: {
          npm_command: "exec",
          npm_execpath: "/usr/lib/node_modules/npm/bin/npx-cli.js",
          npm_package_version: "1.0.0-beta.1"
        },
        moduleUrl
      });

      expect(result.mode).toBe("npx-beta");
      expect(result.command.args).toEqual(["--yes", "poe-code@beta"]);
    });

    it("detects npx@latest execution", () => {
      const result = detectExecutionContext({
        argv: ["/usr/bin/node", "/home/user/.npm/_npx/12345/node_modules/.bin/poe-code", "mcp"],
        env: {
          npm_command: "exec",
          npm_execpath: "/usr/lib/node_modules/npm/bin/npx-cli.js",
          npm_package_json: "/home/user/.npm/_npx/poe-code@latest/package.json"
        },
        moduleUrl
      });

      expect(result.mode).toBe("npx-latest");
      expect(result.command.args).toEqual(["--yes", "poe-code@latest"]);
    });
  });

  describe("global installation detection", () => {
    it("defaults to global when no special conditions match", () => {
      const result = detectExecutionContext({
        argv: ["/usr/bin/node", "/usr/lib/node_modules/poe-code/dist/index.js", "mcp"],
        env: {},
        moduleUrl
      });

      expect(result.mode).toBe("global");
      expect(result.command.command).toBe("poe-code");
      expect(result.command.args).toEqual([]);
    });
  });
});

describe("toMcpServerCommand", () => {
  it("appends subcommand to args", () => {
    const result = toMcpServerCommand(
      { command: "npx", args: ["--yes", "poe-code"] },
      "mcp"
    );

    expect(result).toEqual({
      command: "npx",
      args: ["--yes", "poe-code", "mcp"]
    });
  });

  it("works with global command", () => {
    const result = toMcpServerCommand(
      { command: "poe-code", args: [] },
      "mcp"
    );

    expect(result).toEqual({
      command: "poe-code",
      args: ["mcp"]
    });
  });
});

describe("toOpenCodeMcpCommand", () => {
  it("returns command as array for opencode format", () => {
    const result = toOpenCodeMcpCommand(
      { command: "npx", args: ["-y", "poe-code"] },
      "mcp"
    );

    expect(result).toEqual(["npx", "-y", "poe-code", "mcp"]);
  });

  it("works with npm run dev for development", () => {
    const result = toOpenCodeMcpCommand(
      { command: "npm", args: ["--silent", "--prefix", "/workspace/poe-code", "run", "dev", "--"] },
      "mcp"
    );

    expect(result).toEqual(["npm", "--silent", "--prefix", "/workspace/poe-code", "run", "dev", "--", "mcp"]);
  });
});
