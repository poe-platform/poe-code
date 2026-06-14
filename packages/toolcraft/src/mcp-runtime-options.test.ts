import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { S } from "toolcraft-schema";
import { defineCommand, defineGroup } from "./index.js";

const invokeWithHumanInLoopMock = vi.hoisted(() => vi.fn());

vi.mock("./human-in-loop/index.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./human-in-loop/index.js")>();

  return {
    ...actual,
    invokeWithHumanInLoop: invokeWithHumanInLoopMock,
  };
});

const { createMCPServer } = await import("./mcp.js");
const { McpClient, createSdkTestPair } = await import("tiny-mcp-client");

async function createClient(server: ReturnType<typeof createMCPServer>) {
  return createSdkTestPair(server, () =>
    new McpClient({
      clientInfo: {
        name: "test-client",
        version: "1.0.0",
      },
    })
  );
}

describe("createMCPServer human-in-loop runtime options plumbing", () => {
  beforeEach(() => {
    invokeWithHumanInLoopMock.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("passes the normalized runtime options object to the gate when options.humanInLoop is omitted", async () => {
    invokeWithHumanInLoopMock.mockImplementation(async (_command, context, runtimeOptions) => {
      expect(runtimeOptions).toBe(context.runtimeOptions);
      expect(runtimeOptions).toEqual({});

      return {
        deployed: context.params.target,
      };
    });

    const server = createMCPServer(
      defineGroup({
        name: "root",
        children: [
          defineCommand({
            name: "deploy",
            scope: ["mcp"],
            params: S.Object({
              target: S.String(),
            }),
            handler: async () => "should not run",
          }),
        ],
      }),
      {
        name: "toolcraft-test",
        version: "1.0.0",
        omitRootToolNamePrefix: true,
      }
    );
    const { client, cleanup } = await createClient(server);

    try {
      await expect(
        client.callTool({
          name: "deploy",
          arguments: {
            target: "prod",
          },
        })
      ).resolves.toEqual({
        content: [
          {
            type: "text",
            text: JSON.stringify({
              deployed: "prod",
            }),
          },
        ],
      });
    } finally {
      await cleanup();
    }
  });
});

describe("createMCPServer fetch runtime options plumbing", () => {
  beforeEach(() => {
    invokeWithHumanInLoopMock.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("passes options.fetch to command contexts", async () => {
    invokeWithHumanInLoopMock.mockImplementation(async (command, context) => command.handler(context));
    const injectedFetch = vi.fn<typeof globalThis.fetch>(async () =>
      new Response(JSON.stringify({ ok: true }), {
        headers: {
          "content-type": "application/json",
        },
      })
    );

    const server = createMCPServer(
      defineGroup({
        name: "root",
        children: [
          defineCommand({
            name: "load",
            scope: ["mcp"],
            params: S.Object({}),
            handler: async ({ fetch }) => {
              expect(fetch).toBe(injectedFetch);
              const response = await fetch("https://api.example.com/items");
              return response.json();
            },
          }),
        ],
      }),
      {
        name: "toolcraft-test",
        version: "1.0.0",
        omitRootToolNamePrefix: true,
        fetch: injectedFetch,
      }
    );
    const { client, cleanup } = await createClient(server);

    try {
      await expect(
        client.callTool({
          name: "load",
          arguments: {},
        })
      ).resolves.toEqual({
        content: [
          {
            type: "text",
            text: JSON.stringify({
              ok: true,
            }),
          },
        ],
      });
      expect(injectedFetch).toHaveBeenCalledWith("https://api.example.com/items");
    } finally {
      await cleanup();
    }
  });
});
