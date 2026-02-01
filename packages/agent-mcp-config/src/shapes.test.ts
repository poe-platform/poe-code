import { describe, it, expect } from "vitest";
import {
  standardShape,
  opencodeShape,
  getShapeTransformer
} from "./shapes.js";
import type { McpServerEntry } from "./types.js";

describe("standardShape", () => {
  it("transforms stdio server with command only", () => {
    const entry: McpServerEntry = {
      name: "test",
      config: { transport: "stdio", command: "npx" }
    };
    expect(standardShape(entry)).toEqual({ command: "npx" });
  });

  it("transforms stdio server with args", () => {
    const entry: McpServerEntry = {
      name: "test",
      config: { transport: "stdio", command: "npx", args: ["poe-code", "mcp"] }
    };
    expect(standardShape(entry)).toEqual({
      command: "npx",
      args: ["poe-code", "mcp"]
    });
  });

  it("transforms stdio server with env", () => {
    const entry: McpServerEntry = {
      name: "test",
      config: {
        transport: "stdio",
        command: "npx",
        env: { POE_API_KEY: "key" }
      }
    };
    expect(standardShape(entry)).toEqual({
      command: "npx",
      env: { POE_API_KEY: "key" }
    });
  });

  it("transforms stdio server with all fields", () => {
    const entry: McpServerEntry = {
      name: "test",
      config: {
        transport: "stdio",
        command: "npx",
        args: ["test"],
        env: { KEY: "value" }
      }
    };
    expect(standardShape(entry)).toEqual({
      command: "npx",
      args: ["test"],
      env: { KEY: "value" }
    });
  });

  it("returns undefined for disabled server", () => {
    const entry: McpServerEntry = {
      name: "test",
      config: { transport: "stdio", command: "npx" },
      enabled: false
    };
    expect(standardShape(entry)).toBeUndefined();
  });

  it("treats enabled: true as enabled", () => {
    const entry: McpServerEntry = {
      name: "test",
      config: { transport: "stdio", command: "npx" },
      enabled: true
    };
    expect(standardShape(entry)).toEqual({ command: "npx" });
  });

  it("omits empty args array", () => {
    const entry: McpServerEntry = {
      name: "test",
      config: { transport: "stdio", command: "npx", args: [] }
    };
    expect(standardShape(entry)).toEqual({ command: "npx" });
  });

  it("omits empty env object", () => {
    const entry: McpServerEntry = {
      name: "test",
      config: { transport: "stdio", command: "npx", env: {} }
    };
    expect(standardShape(entry)).toEqual({ command: "npx" });
  });

  it("transforms http server to command with url", () => {
    const entry: McpServerEntry = {
      name: "test",
      config: { transport: "http", url: "http://localhost:3000" }
    };
    expect(standardShape(entry)).toEqual({ command: "http://localhost:3000" });
  });
});

describe("opencodeShape", () => {
  it("transforms stdio server with type: local and array command", () => {
    const entry: McpServerEntry = {
      name: "test",
      config: { transport: "stdio", command: "npx" }
    };
    expect(opencodeShape(entry)).toEqual({
      type: "local",
      command: ["npx"],
      enabled: true
    });
  });

  it("transforms stdio server with args into single command array", () => {
    const entry: McpServerEntry = {
      name: "test",
      config: { transport: "stdio", command: "npx", args: ["test"] }
    };
    expect(opencodeShape(entry)).toEqual({
      type: "local",
      command: ["npx", "test"],
      enabled: true
    });
  });

  it("transforms stdio server with env", () => {
    const entry: McpServerEntry = {
      name: "test",
      config: {
        transport: "stdio",
        command: "npx",
        env: { KEY: "value" }
      }
    };
    expect(opencodeShape(entry)).toEqual({
      type: "local",
      command: ["npx"],
      env: { KEY: "value" },
      enabled: true
    });
  });

  it("sets enabled: false for disabled server", () => {
    const entry: McpServerEntry = {
      name: "test",
      config: { transport: "stdio", command: "npx" },
      enabled: false
    };
    expect(opencodeShape(entry)).toEqual({
      type: "local",
      command: ["npx"],
      enabled: false
    });
  });

  it("transforms http server", () => {
    const entry: McpServerEntry = {
      name: "test",
      config: { transport: "http", url: "http://localhost:3000" }
    };
    expect(opencodeShape(entry)).toEqual({
      type: "local",
      command: ["http://localhost:3000"],
      enabled: true
    });
  });
});

describe("getShapeTransformer", () => {
  it("returns standardShape for standard", () => {
    expect(getShapeTransformer("standard")).toBe(standardShape);
  });

  it("returns opencodeShape for opencode", () => {
    expect(getShapeTransformer("opencode")).toBe(opencodeShape);
  });
});
