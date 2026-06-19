import { beforeEach, describe, expect, it, vi } from "vitest";
import { S } from "toolcraft-schema";
import { defineCommand, defineGroup } from "./index.js";

const invokeWithHumanInLoopMock = vi.hoisted(() => vi.fn());

vi.mock("./human-in-loop/index.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./human-in-loop/index.js")>();

  return {
    ...actual,
    invokeWithHumanInLoop: invokeWithHumanInLoopMock
  };
});

const { createSDK } = await import("./sdk.js");

describe("createSDK human-in-loop runtime options plumbing", () => {
  beforeEach(() => {
    invokeWithHumanInLoopMock.mockReset();
  });

  it("passes the normalized runtime options object to the gate when options.humanInLoop is omitted", async () => {
    invokeWithHumanInLoopMock.mockImplementation(async (_command, context, runtimeOptions) => {
      expect(runtimeOptions).toBe(context.runtimeOptions);
      expect(runtimeOptions).toEqual({});

      return {
        deployed: context.params.target
      };
    });

    const sdk = createSDK(
      defineGroup({
        name: "root",
        children: [
          defineCommand({
            name: "deploy",
            params: S.Object({
              target: S.String()
            }),
            handler: async () => "should not run"
          })
        ]
      })
    ) as {
      deploy(params: { target: string }): Promise<{ deployed: string }>;
    };

    await expect(sdk.deploy({ target: "prod" })).resolves.toEqual({
      deployed: "prod"
    });
  });
});

describe("createSDK API version runtime options plumbing", () => {
  it("passes options.apiVersion to command requirement checks", async () => {
    invokeWithHumanInLoopMock.mockReset();
    invokeWithHumanInLoopMock.mockImplementation(async (command, context) =>
      command.handler(context)
    );

    const sdk = createSDK(
      defineGroup({
        name: "root",
        children: [
          defineCommand({
            name: "deploy",
            params: S.Object({}),
            requires: {
              apiVersion: ">=1.2.3"
            },
            handler: async () => "deployed"
          })
        ]
      }),
      {
        apiVersion: "1.2.3"
      }
    ) as {
      deploy(params: Record<string, never>): Promise<string>;
    };

    await expect(sdk.deploy({})).resolves.toBe("deployed");
  });
});

describe("createSDK fetch runtime options plumbing", () => {
  it("passes options.fetch to command contexts", async () => {
    invokeWithHumanInLoopMock.mockReset();
    invokeWithHumanInLoopMock.mockImplementation(async (command, context) =>
      command.handler(context)
    );
    const injectedFetch = vi.fn<typeof globalThis.fetch>(
      async () =>
        new Response(JSON.stringify({ ok: true }), {
          headers: {
            "content-type": "application/json"
          }
        })
    );

    const sdk = createSDK(
      defineGroup({
        name: "root",
        children: [
          defineCommand({
            name: "load",
            params: S.Object({}),
            handler: async ({ fetch }) => {
              expect(fetch).toBe(injectedFetch);
              const response = await fetch("https://api.example.com/items");
              return response.json();
            }
          })
        ]
      }),
      {
        fetch: injectedFetch
      }
    ) as {
      load(params: Record<string, never>): Promise<{ ok: boolean }>;
    };

    await expect(sdk.load({})).resolves.toEqual({ ok: true });
    expect(injectedFetch).toHaveBeenCalledWith("https://api.example.com/items");
  });
});

describe("createSDK diagnostic runtime options plumbing", () => {
  beforeEach(() => {
    invokeWithHumanInLoopMock.mockReset();
  });

  it("passes log level and logger through command contexts", async () => {
    const events: Array<{ level: string; message: string }> = [];
    invokeWithHumanInLoopMock.mockImplementation(async (command, context) =>
      command.handler(context)
    );

    const sdk = createSDK(
      defineGroup({
        name: "root",
        children: [
          defineCommand({
            name: "deploy",
            params: S.Object({}),
            handler: async ({ diagnostics }) => {
              expect(diagnostics.level).toBe("info");
              diagnostics.emit({ level: "debug", message: "debug suppressed" });
              diagnostics.emit({ level: "info", message: "deploying", category: "progress" });
              return "deployed";
            }
          })
        ]
      }),
      {
        logLevel: "info",
        logger: (event) => {
          events.push({ level: event.level, message: event.message });
        }
      }
    ) as {
      deploy(params: Record<string, never>): Promise<string>;
    };

    await expect(sdk.deploy({})).resolves.toBe("deployed");
    expect(events).toEqual([{ level: "info", message: "deploying" }]);
  });
});
