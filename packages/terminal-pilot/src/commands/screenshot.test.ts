import { describe, expect, it, vi } from "vitest";
import { renderTerminalPng } from "terminal-png";
import { screenshot } from "./screenshot.js";
import type { TerminalPilotCommandServices, TerminalPilotRuntime } from "./runtime.js";

vi.mock("terminal-png", () => ({
  renderTerminalPng: vi.fn()
}));

function createCommandContext(runtime: TerminalPilotRuntime): TerminalPilotCommandServices & {
  fetch: typeof globalThis.fetch;
  fs: {
    exists(path: string): Promise<boolean>;
    readFile(path: string, encoding?: BufferEncoding): Promise<string>;
    writeFile(path: string, contents: string): Promise<void>;
  };
  env: { get(key: string): string | undefined };
  progress(message: string): void;
  secrets: Record<string, never>;
} {
  return {
    terminalPilotRuntime: runtime,
    fetch: globalThis.fetch,
    fs: {
      exists: async () => false,
      readFile: async () => "",
      writeFile: async () => undefined
    },
    env: {
      get: () => undefined
    },
    progress: () => undefined,
    secrets: {}
  };
}

describe("screenshot command", () => {
  it("renders the session raw screen buffer as a PNG", async () => {
    const screen = {
      rawLines: ["\u001b[36mcyan\u001b[0m", "\u001b[35mviolet\u001b[0m"],
      lines: ["cyan", "violet"],
      cursor: { row: 1, col: 0 },
      size: { rows: 24, cols: 80 }
    };
    const session = {
      screen: vi.fn().mockResolvedValue(screen)
    };
    const runtime = {
      resolveSession: vi.fn().mockResolvedValue({
        name: "colors",
        session
      })
    } as unknown as TerminalPilotRuntime;
    const renderTerminalPngMock = vi.mocked(renderTerminalPng);

    renderTerminalPngMock.mockResolvedValue(Buffer.from("png"));

    await expect(
      screenshot.handler({
        ...createCommandContext(runtime),
        params: {
          session: "colors",
          output: "screen.png",
          window: false,
          padding: 16
        }
      })
    ).resolves.toBeUndefined();

    expect(runtime.resolveSession).toHaveBeenCalledWith("colors", expect.anything());
    expect(session.screen).toHaveBeenCalledTimes(1);
    expect(renderTerminalPngMock).toHaveBeenCalledWith(
      "\u001b[36mcyan\u001b[0m\n\u001b[35mviolet\u001b[0m",
      {
        output: "screen.png",
        window: false,
        padding: 16
      }
    );
  });
});
