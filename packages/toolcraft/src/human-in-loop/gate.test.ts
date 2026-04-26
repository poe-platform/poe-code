import { beforeEach, describe, expect, it, vi } from "vitest";
import { mockProvider, osascriptProvider } from "@poe-code/agent-human-in-loop";
import { S } from "toolcraft-schema";
import type { HandlerContext } from "../index.js";
import { UserError, defineCommand } from "../index.js";
import { invokeWithHumanInLoop } from "./gate.js";
import { ApprovalDeclinedError } from "./types.js";

const defaultProviderForPlatformMock = vi.hoisted(() => vi.fn());
const osascriptProviderMock = vi.hoisted(() => vi.fn());

vi.mock("./default-provider.js", () => ({
  defaultProviderForPlatform: defaultProviderForPlatformMock,
}));

vi.mock("@poe-code/agent-human-in-loop", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@poe-code/agent-human-in-loop")>();

  return {
    ...actual,
    osascriptProvider: osascriptProviderMock,
  };
});

function createContext(params: { name: string } = { name: "production" }): HandlerContext {
  return {
    params,
    secrets: {},
    fetch: globalThis.fetch,
    fs: {
      readFile: vi.fn(),
      writeFile: vi.fn(),
      exists: vi.fn(),
    },
    env: {
      get: vi.fn(),
    },
    progress: vi.fn(),
  };
}

function createSyncCommand(handler: ReturnType<typeof vi.fn>) {
  return defineCommand({
    name: "deploy",
    params: S.Object({
      name: S.String(),
    }),
    humanInLoop: {
      mode: "sync",
      message: ({ params, commandPath }) => `Run ${commandPath} for ${params.name}?`,
      declineInputPrompt: "Why not?",
    },
    handler,
  });
}

describe("invokeWithHumanInLoop", () => {
  beforeEach(() => {
    defaultProviderForPlatformMock.mockReset();
    osascriptProviderMock.mockReset();
  });

  it("runs the handler directly when the command has no human-in-loop config", async () => {
    const handler = vi.fn(async () => "done");
    const command = defineCommand({
      name: "deploy",
      params: S.Object({
        name: S.String(),
      }),
      handler,
    });

    await expect(invokeWithHumanInLoop(command, createContext(), undefined, "deploy")).resolves.toBe("done");

    expect(defaultProviderForPlatformMock).not.toHaveBeenCalled();
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("runs the handler after sync approval and passes the formatted message to the provider", async () => {
    const handler = vi.fn(async () => "done");
    const command = createSyncCommand(handler);
    const provider = mockProvider({ outcome: "approved" });
    const requestApprovalSpy = vi.spyOn(provider, "requestApproval");

    await expect(
      invokeWithHumanInLoop(command, createContext(), { provider }, "root.deploy")
    ).resolves.toBe("done");

    expect(requestApprovalSpy).toHaveBeenCalledWith({
      message: "Run root.deploy for production?",
      declineInputPrompt: "Why not?",
    });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("throws ApprovalDeclinedError without a reason when sync approval is declined", async () => {
    const handler = vi.fn(async () => "done");
    const command = createSyncCommand(handler);

    await expect(
      invokeWithHumanInLoop(command, createContext(), { provider: mockProvider({ outcome: "declined" }) }, "deploy")
    ).rejects.toBeInstanceOf(ApprovalDeclinedError);

    await invokeWithHumanInLoop(
      command,
      createContext(),
      { provider: mockProvider({ outcome: "declined" }) },
      "deploy"
    ).catch((error: unknown) => {
      expect(error).toBeInstanceOf(ApprovalDeclinedError);
      expect(error).toMatchObject({
        commandPath: "deploy",
        reason: undefined,
        message: "Declined.",
      });
    });
    expect(handler).not.toHaveBeenCalled();
  });

  it("throws ApprovalDeclinedError carrying the decline reason", async () => {
    const handler = vi.fn(async () => "done");
    const command = createSyncCommand(handler);

    await invokeWithHumanInLoop(
      command,
      createContext(),
      { provider: mockProvider({ outcome: "declined", reason: "Need ticket" }) },
      "deploy.production"
    ).catch((error: unknown) => {
      expect(error).toBeInstanceOf(ApprovalDeclinedError);
      expect(error).toMatchObject({
        commandPath: "deploy.production",
        reason: "Need ticket",
        message: "Declined: Need ticket",
      });
    });
    expect(handler).not.toHaveBeenCalled();
  });

  it("uses the lazy darwin default provider and memoizes it per runtime options object", async () => {
    const handler = vi.fn(async () => "done");
    const command = createSyncCommand(handler);
    const runtimeOptions = {};

    osascriptProviderMock.mockReturnValue(mockProvider({ outcome: "approved" }));
    defaultProviderForPlatformMock.mockImplementation(() =>
      osascriptProvider({
        title: "Approval needed",
        binary: "/fake/osascript",
      })
    );

    expect(defaultProviderForPlatformMock).not.toHaveBeenCalled();

    await expect(invokeWithHumanInLoop(command, createContext(), runtimeOptions, "deploy")).resolves.toBe("done");
    await expect(
      invokeWithHumanInLoop(command, createContext({ name: "staging" }), runtimeOptions, "deploy")
    ).resolves.toBe("done");

    expect(defaultProviderForPlatformMock).toHaveBeenCalledTimes(1);
    expect(osascriptProviderMock).toHaveBeenCalledWith({
      title: "Approval needed",
      binary: "/fake/osascript",
    });
  });

  it("surfaces the documented UserError when no provider is configured", async () => {
    const handler = vi.fn(async () => "done");
    const command = createSyncCommand(handler);

    defaultProviderForPlatformMock.mockReturnValue({
      id: "noProviderConfigured",
      async requestApproval() {
        throw new UserError(
          "no human-in-loop provider configured for this platform — pass humanInLoop.provider to the runtime"
        );
      },
    });

    await expect(invokeWithHumanInLoop(command, createContext(), {}, "deploy")).rejects.toThrowError(
      new UserError(
        "no human-in-loop provider configured for this platform — pass humanInLoop.provider to the runtime"
      )
    );
    expect(handler).not.toHaveBeenCalled();
  });

  it("throws an explicit not-yet-implemented error for async mode", async () => {
    const handler = vi.fn(async () => "done");
    const command = defineCommand({
      name: "deploy",
      params: S.Object({
        name: S.String(),
      }),
      humanInLoop: {
        mode: "async",
        message: ({ commandPath }) => `Queue ${commandPath}?`,
      },
      handler,
    });

    await expect(invokeWithHumanInLoop(command, createContext(), undefined, "deploy")).rejects.toThrowError(
      "human-in-loop async mode not yet implemented"
    );

    expect(defaultProviderForPlatformMock).not.toHaveBeenCalled();
    expect(handler).not.toHaveBeenCalled();
  });
});
