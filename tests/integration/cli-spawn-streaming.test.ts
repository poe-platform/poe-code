import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { spawn as spawnChildProcess } from "node:child_process";
import { PassThrough } from "node:stream";
import { EventEmitter } from "node:events";
import { Volume, createFsFromVolume } from "memfs";
import type { FileSystem } from "../../src/utils/file-system.js";
import { createProgram } from "../../src/cli/program.js";

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return {
    ...actual,
    spawn: vi.fn(),
  };
});

vi.mock("toolcraft-design", async (importOriginal) => {
  const actual = await importOriginal<typeof import("toolcraft-design")>();
  return {
    ...actual,
    confirm: vi.fn().mockResolvedValue(true),
    isCancel: vi.fn().mockReturnValue(false)
  };
});

const cwd = "/repo";
const homeDir = "/home/test";

function createMemFs(): FileSystem {
  const vol = new Volume();
  vol.mkdirSync(`${homeDir}/.poe-code`, { recursive: true });
  return createFsFromVolume(vol).promises as unknown as FileSystem;
}

function stripAnsi(input: string): string {
  let output = "";
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    if (char !== "\u001b") {
      output += char;
      continue;
    }
    const next = input[index + 1];
    if (next !== "[") continue;

    index += 2;
    while (index < input.length && input[index] !== "m") {
      index += 1;
    }
  }
  return output;
}

type MockChild = EventEmitter & {
  stdout: PassThrough;
  stderr: PassThrough;
  stdin: PassThrough;
};

function createMockChildProcess(options: {
  stdoutLines: string[];
  exitCode?: number;
}): MockChild {
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const stdin = new PassThrough();
  const child = new EventEmitter() as MockChild;
  child.stdout = stdout;
  child.stderr = stderr;
  child.stdin = stdin;

  queueMicrotask(() => {
    for (const line of options.stdoutLines) {
      stdout.write(`${line}\n`);
    }
    stdout.end();
    stderr.end();
    child.emit("close", options.exitCode ?? 0);
  });

  return child;
}

describe("CLI spawn streaming integration", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = {
      ...originalEnv,
      POE_API_KEY: "test-api-key",
      FORCE_COLOR: "1"
    };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("streams tool_start/tool_complete/agent_message in order and ignores invalid events", async () => {
    const mockStdoutLines = [
      JSON.stringify({
        type: "item.started",
        item: { id: "1", type: "command_execution", command: "npm test" }
      }),
      JSON.stringify({
        type: "item.completed",
        item: { id: "1", type: "command_execution", path: "result.txt" }
      }),
      // Invalid event type from the underlying agent stream (should be ignored).
      JSON.stringify({ type: "some.future.event", foo: "bar" }),
      JSON.stringify({
        type: "item.completed",
        item: { type: "agent_message", text: "Hi" }
      })
    ];

    vi.mocked(spawnChildProcess).mockImplementation(() =>
      createMockChildProcess({ stdoutLines: mockStdoutLines }) as any
    );

    const program = createProgram({
      fs: createMemFs(),
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      commandRunner: vi.fn().mockResolvedValue({ stdout: "", stderr: "", exitCode: 0 }),
      logger: () => {}
    });

    const chunks: string[] = [];
    const spy = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(((chunk: unknown) => {
        chunks.push(String(chunk));
        return true;
      }) as unknown as typeof process.stdout.write);

    try {
      await program.parseAsync([
        "node",
        "cli",
        "--yes",
        "spawn",
        "--mode",
        "yolo",
        "codex",
        "hello"
      ]);
    } finally {
      spy.mockRestore();
    }

    expect(spawnChildProcess).toHaveBeenCalledTimes(1);

    const plainChunks = chunks.map((chunk) => stripAnsi(chunk));
    expect(plainChunks).toEqual([
      "  → exec: npm test\n",
      "  ✓ exec\n",
      "· agent: Hi\n"
    ]);
  });
});
