import { afterEach, describe, expect, it, vi } from "vitest";
import { S } from "toolcraft-schema";
import { defineCommand, defineGroup, type HandlerFs } from "./index.js";
import { runCLI } from "./cli.js";

afterEach(() => {
  process.exitCode = undefined;
});

describe("runCLI hermetic runtime options plumbing", () => {
  it("uses options.env for secrets, requirements, and handler env and options.fs for handler fs", async () => {
    const injectedEnv = {
      POE_API_KEY: "auth-token",
      TOOL_TOKEN: "secret-token",
      TOOL_VALUE: "visible-value"
    };
    const injectedFs = {
      readFile: vi.fn(async () => "contents"),
      writeFile: vi.fn(async () => undefined),
      exists: vi.fn(async () => true),
      lstat: vi.fn(async () => ({ isSymbolicLink: () => false })),
      rename: vi.fn(async () => undefined),
      unlink: vi.fn(async () => undefined)
    } satisfies HandlerFs;
    const handler = vi.fn(async ({ env, fs, secrets }) => {
      expect(env.get("TOOL_VALUE")).toBe("visible-value");
      expect(fs).toBe(injectedFs);
      expect(secrets.token).toBe("secret-token");
      await fs.readFile("/virtual/input.txt");
    });

    await runCLI(
      defineGroup({
        name: "root",
        children: [
          defineCommand({
            name: "inspect",
            params: S.Object({}),
            secrets: {
              token: {
                env: "TOOL_TOKEN"
              }
            },
            requires: {
              auth: true
            },
            handler,
            render: {
              rich: () => undefined
            }
          })
        ]
      }),
      {
        argv: ["node", "root", "inspect"],
        env: injectedEnv,
        fs: injectedFs,
        outputEmitter: () => undefined
      }
    );

    expect(handler).toHaveBeenCalledOnce();
    expect(injectedFs.readFile).toHaveBeenCalledWith("/virtual/input.txt");
    expect(process.exitCode).toBeUndefined();
  });

  it("passes rendered command output to options.outputEmitter", async () => {
    const entries: string[] = [];

    await runCLI(
      defineGroup({
        name: "root",
        children: [
          defineCommand({
            name: "deploy",
            params: S.Object({}),
            handler: async () => "deployed",
            render: {
              rich: (result, { logger }) => {
                logger.success(result);
              }
            }
          })
        ]
      }),
      {
        argv: ["node", "root", "deploy"],
        outputEmitter: (entry) => entries.push(entry)
      }
    );

    expect(entries).toEqual(["deployed"]);
  });
});
