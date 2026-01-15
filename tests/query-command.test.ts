import { describe, it, expect, beforeEach, vi } from "vitest";
import { Volume, createFsFromVolume } from "memfs";
import { Readable } from "node:stream";
import { createProgram } from "../src/cli/program.js";
import type { FileSystem } from "../src/utils/file-system.js";

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

const cwd = "/repo";
const homeDir = "/home/test";
const credentialsPath = `${homeDir}/.poe-code/credentials.json`;

function createMemfs(apiKey?: string): FileSystem {
  const volume = new Volume();
  volume.mkdirSync(`${homeDir}/.poe-code`, { recursive: true });
  if (apiKey) {
    volume.writeFileSync(
      credentialsPath,
      JSON.stringify({ apiKey })
    );
  }
  return createFsFromVolume(volume).promises as unknown as FileSystem;
}

function createQueryProgram(options?: {
  fs?: FileSystem;
  logs?: string[];
}) {
  const logs = options?.logs ?? [];
  const fs = options?.fs ?? createMemfs("test-key");
  const program = createProgram({
    fs,
    prompts: vi.fn(),
    env: { cwd, homeDir },
    logger: (message) => {
      logs.push(message);
    },
    suppressCommanderOutput: true
  });
  return { program, logs };
}

describe("query command", () => {
  beforeEach(() => {
    fetchMock.mockReset();
  });

  it("calls Poe API with the provided prompt and prints the response", async () => {
    const fs = createMemfs("secret-key");
    const { program } = createQueryProgram({ fs });
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: "LLM says hi"
            }
          }
        ]
      })
    });

    const stdoutSpy = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);

    await program.parseAsync([
      "node",
      "cli",
      "query",
      "--model",
      "custom-model",
      "--system",
      "stay calm",
      "Hello world"
    ]);

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.poe.com/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer secret-key"
        },
        body: JSON.stringify({
          model: "custom-model",
          messages: [
            { role: "system", content: "stay calm" },
            { role: "user", content: "Hello world" }
          ]
        })
      }
    );
    expect(stdoutSpy).toHaveBeenCalledWith("LLM says hi");
    expect(stdoutSpy).toHaveBeenCalledWith("\n");

    stdoutSpy.mockRestore();
  });

  it("consumes prompt text from stdin when no argument is provided", async () => {
    const fs = createMemfs("pipe-key");
    const { program } = createQueryProgram({ fs });
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: "stdin response"
            }
          }
        ]
      })
    });

    const stdinStream = Readable.from([Buffer.from("Prompt via stdin")]);
    Object.defineProperty(stdinStream, "isTTY", { value: false });
    const stdinSpy = vi
      .spyOn(process, "stdin", "get")
      .mockReturnValue(stdinStream as unknown as typeof process.stdin);
    const stdoutSpy = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);

    await program.parseAsync(["node", "cli", "query"]);

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.poe.com/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer pipe-key"
        },
        body: JSON.stringify({
          model: "Claude-Sonnet-4.5",
          messages: [{ role: "user", content: "Prompt via stdin" }]
        })
      }
    );

    stdinSpy.mockRestore();
    stdoutSpy.mockRestore();
  });

  it("logs dry run output and skips the LLM call", async () => {
    const logs: string[] = [];
    const { program } = createQueryProgram({
      fs: createMemfs(),
      logs
    });

    await program.parseAsync([
      "node",
      "cli",
      "--dry-run",
      "query",
      "Dry run prompt"
    ]);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(
      logs.some((line) =>
        line.includes(
          "Dry run: would query model Claude-Sonnet-4.5 with prompt (14 chars)"
        )
      )
    ).toBe(true);
  });
});
