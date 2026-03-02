import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Volume, createFsFromVolume } from "memfs";
import path from "node:path";
import type { FileSystem } from "../utils/file-system.js";

const renderAcpStreamMock = vi.hoisted(
  () =>
    vi.fn(async (events: AsyncIterable<unknown>) => {
      for await (const ignoredEvent of events) {
        // noop
      }
    })
);

vi.mock("@poe-code/agent-spawn", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@poe-code/agent-spawn")>();
  return {
    ...actual,
    renderAcpStream: renderAcpStreamMock
  };
});

vi.mock("../../sdk/spawn.js", () => ({
  spawn: vi.fn()
}));

import { createProgram } from "../program.js";
import { spawn as sdkSpawn } from "../../sdk/spawn.js";

const cwd = "/repo";
const homeDir = "/home/test";

function createMemFs(files?: Record<string, string>): FileSystem {
  const vol = new Volume();
  vol.mkdirSync(homeDir, { recursive: true });
  vol.mkdirSync(cwd, { recursive: true });
  if (files) {
    for (const [filePath, content] of Object.entries(files)) {
      const dir = path.dirname(filePath);
      vol.mkdirSync(dir, { recursive: true });
      vol.writeFileSync(filePath, content, "utf8");
    }
  }
  return createFsFromVolume(vol).promises as unknown as FileSystem;
}

function mockSpawnSuccess(output: string) {
  return {
    events: (async function* () {
      yield { event: "agent_message", text: output };
    })(),
    result: Promise.resolve({
      stdout: output,
      stderr: "",
      exitCode: 0
    })
  };
}

const validPipeline = `
name: test-pipeline
steps:
  - name: review
    agent: claude-code
    prompt: Review this code
`;

const invalidPipeline = `
steps:
  - name: review
    agent: claude-code
    prompt: Review
`;

const pipelinePath = "/repo/pipeline.yaml";

describe("pipeline command", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv, FORCE_COLOR: "1" };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe("pipeline validate", () => {
    it("reports valid pipeline", async () => {
      const fs = createMemFs({ [pipelinePath]: validPipeline });
      const program = createProgram({
        fs,
        prompts: vi.fn().mockResolvedValue({}),
        env: { cwd, homeDir },
        logger: () => {},
        suppressCommanderOutput: true
      });

      await program.parseAsync([
        "node",
        "cli",
        "pipeline",
        "validate",
        pipelinePath
      ]);
    });

    it("throws on invalid pipeline", async () => {
      const fs = createMemFs({ [pipelinePath]: invalidPipeline });
      const program = createProgram({
        fs,
        prompts: vi.fn().mockResolvedValue({}),
        env: { cwd, homeDir },
        logger: () => {},
        suppressCommanderOutput: true
      });

      await expect(
        program.parseAsync([
          "node",
          "cli",
          "pipeline",
          "validate",
          pipelinePath
        ])
      ).rejects.toThrow("name");
    });
  });

  describe("pipeline run", () => {
    it("runs a pipeline and spawns agents", async () => {
      vi.mocked(sdkSpawn).mockReturnValue(mockSpawnSuccess("review output"));

      const fs = createMemFs({ [pipelinePath]: validPipeline });
      const program = createProgram({
        fs,
        prompts: vi.fn().mockResolvedValue({}),
        env: { cwd, homeDir },
        logger: () => {},
        suppressCommanderOutput: true
      });

      await program.parseAsync([
        "node",
        "cli",
        "pipeline",
        "run",
        pipelinePath
      ]);

      expect(sdkSpawn).toHaveBeenCalledWith("claude-code", expect.objectContaining({
        prompt: "Review this code",
        mode: "yolo"
      }));
    });

    it("shows dry run without spawning", async () => {
      const fs = createMemFs({ [pipelinePath]: validPipeline });
      const program = createProgram({
        fs,
        prompts: vi.fn().mockResolvedValue({}),
        env: { cwd, homeDir },
        logger: () => {},
        suppressCommanderOutput: true
      });

      await program.parseAsync([
        "node",
        "cli",
        "--dry-run",
        "pipeline",
        "run",
        pipelinePath
      ]);

      expect(sdkSpawn).not.toHaveBeenCalled();
    });

    it("sets exit code on failure", async () => {
      vi.mocked(sdkSpawn).mockReturnValue({
        events: (async function* () {})(),
        result: Promise.resolve({
          stdout: "",
          stderr: "error",
          exitCode: 1
        })
      });

      const fs = createMemFs({ [pipelinePath]: validPipeline });
      const program = createProgram({
        fs,
        prompts: vi.fn().mockResolvedValue({}),
        env: { cwd, homeDir },
        logger: () => {},
        suppressCommanderOutput: true
      });

      const originalExitCode = process.exitCode;
      await program.parseAsync([
        "node",
        "cli",
        "pipeline",
        "run",
        pipelinePath
      ]);

      expect(process.exitCode).toBe(1);
      process.exitCode = originalExitCode;
    });
  });
});
