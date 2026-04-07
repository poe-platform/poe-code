import { afterEach, describe, expect, it, vi } from "vitest";
import { Volume, createFsFromVolume } from "memfs";
import { Command } from "commander";
import { createCliContainer } from "../container.js";
import type { FileSystem } from "../../utils/file-system.js";
import { registerPlanCommand } from "./plan.js";

const {
  selectMock,
  confirmOrCancelMock,
  isCancelMock
} = vi.hoisted(() => ({
  selectMock: vi.fn(),
  confirmOrCancelMock: vi.fn().mockResolvedValue(true),
  isCancelMock: vi.fn(() => false)
}));

vi.mock("@poe-code/design-system", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@poe-code/design-system")>();
  return {
    ...actual,
    intro: vi.fn(),
    select: selectMock,
    confirmOrCancel: confirmOrCancelMock,
    isCancel: isCancelMock
  };
});

const cwd = "/repo";
const homeDir = "/home/test";

function createMemFs(files: Record<string, string> = {}): FileSystem {
  const volume = Volume.fromJSON(files, "/");
  volume.mkdirSync(cwd, { recursive: true });
  volume.mkdirSync(homeDir, { recursive: true });
  return createFsFromVolume(volume).promises as unknown as FileSystem;
}

function createBaseProgram(): Command {
  const program = new Command();
  program.exitOverride();
  program.name("poe-code").option("-y, --yes").option("--dry-run").option("--verbose");
  return program;
}

describe("plan command", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    process.env.OUTPUT_FORMAT = "";
  });

  it("lists plans as json", async () => {
    const writeSpy = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    const container = createCliContainer({
      fs: createMemFs({
        "/repo/.poe-code/pipeline/plans/plan-a.yaml": [
          "tasks:",
          "  - id: first",
          "    title: First",
          "    prompt: First prompt",
          "    status: open",
          ""
        ].join("\n")
      }),
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: () => {}
    });
    const program = createBaseProgram();
    registerPlanCommand(program, container);

    await program.parseAsync(["node", "cli", "plan", "list", "--output", "json"]);

    const output = writeSpy.mock.calls.map(([chunk]) => String(chunk)).join("");
    expect(JSON.parse(output)).toEqual([
      expect.objectContaining({
        source: "pipeline",
        name: "plan-a.yaml",
        detail: "0/1 done"
      })
    ]);
  });

  it("filters list output by source", async () => {
    const writeSpy = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    const container = createCliContainer({
      fs: createMemFs({
        "/repo/.poe-code/pipeline/plans/plan-a.yaml": [
          "tasks:",
          "  - id: first",
          "    title: First",
          "    prompt: First prompt",
          "    status: open",
          ""
        ].join("\n"),
        "/repo/.poe-code/ralph/plans/plan-b.md": [
          "---",
          "status:",
          "  state: open",
          "  iteration: 0",
          "---",
          "# Ralph plan"
        ].join("\n")
      }),
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: () => {}
    });
    const program = createBaseProgram();
    registerPlanCommand(program, container);

    await program.parseAsync([
      "node",
      "cli",
      "plan",
      "list",
      "--source",
      "pipeline",
      "--output",
      "json"
    ]);

    const output = writeSpy.mock.calls.map(([chunk]) => String(chunk)).join("");
    expect(JSON.parse(output)).toEqual([
      expect.objectContaining({
        source: "pipeline",
        name: "plan-a.yaml"
      })
    ]);
  });

  it("renders a pipeline plan preview", async () => {
    const writeSpy = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    const container = createCliContainer({
      fs: createMemFs({
        "/repo/.poe-code/pipeline/plans/plan-a.yaml": [
          "tasks:",
          "  - id: first",
          "    title: First task",
          "    prompt: Ship it",
          "    status: done",
          ""
        ].join("\n")
      }),
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: () => {}
    });
    const program = createBaseProgram();
    registerPlanCommand(program, container);

    await program.parseAsync([
      "node",
      "cli",
      "plan",
      "view",
      ".poe-code/pipeline/plans/plan-a.yaml"
    ]);

    const output = writeSpy.mock.calls.map(([chunk]) => String(chunk)).join("");
    expect(output).toContain("plan-a.yaml");
    expect(output).toContain("First task");
  });

  it("uses the source filter for plan view selection", async () => {
    const writeSpy = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    const container = createCliContainer({
      fs: createMemFs({
        "/repo/.poe-code/pipeline/plans/plan-a.yaml": [
          "tasks:",
          "  - id: first",
          "    title: Pipeline task",
          "    prompt: Ship it",
          "    status: open",
          ""
        ].join("\n"),
        "/repo/.poe-code/ralph/plans/plan-b.md": [
          "---",
          "status:",
          "  state: open",
          "  iteration: 0",
          "---",
          "# Ralph plan"
        ].join("\n")
      }),
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: () => {}
    });
    const program = createBaseProgram();
    registerPlanCommand(program, container);

    await program.parseAsync([
      "node",
      "cli",
      "--yes",
      "plan",
      "view",
      "--source",
      "pipeline",
      "--output",
      "json"
    ]);

    const output = writeSpy.mock.calls.map(([chunk]) => String(chunk)).join("");
    expect(JSON.parse(output)).toEqual(
      expect.objectContaining({
        source: "pipeline",
        path: ".poe-code/pipeline/plans/plan-a.yaml"
      })
    );
  });

  it("archives the first matching plan with --yes", async () => {
    const writeSpy = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    const fs = createMemFs({
      "/repo/.poe-code/ralph/plans/plan-a.md": "# Plan"
    });
    const container = createCliContainer({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir, variables: { EDITOR: "cat" } },
      logger: () => {}
    });
    const program = createBaseProgram();
    registerPlanCommand(program, container);

    await program.parseAsync(["node", "cli", "--yes", "plan", "archive"]);

    const output = writeSpy.mock.calls.map(([chunk]) => String(chunk)).join("");
    expect(output).toContain("Archived");
    await expect(
      fs.readFile("/repo/.poe-code/ralph/plans/archive/plan-a.md", "utf8")
    ).resolves.toBe("# Plan");
    expect(confirmOrCancelMock).not.toHaveBeenCalled();
  });

  it("does not archive a plan when confirmation is declined", async () => {
    confirmOrCancelMock.mockResolvedValueOnce(false);

    const writeSpy = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    const fs = createMemFs({
      "/repo/.poe-code/ralph/plans/plan-a.md": "# Plan"
    });
    const container = createCliContainer({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: () => {}
    });
    const program = createBaseProgram();
    registerPlanCommand(program, container);

    await program.parseAsync([
      "node",
      "cli",
      "plan",
      "archive",
      ".poe-code/ralph/plans/plan-a.md"
    ]);

    const output = writeSpy.mock.calls.map(([chunk]) => String(chunk)).join("");
    expect(output).toBe("");
    await expect(
      fs.readFile("/repo/.poe-code/ralph/plans/plan-a.md", "utf8")
    ).resolves.toBe("# Plan");
    await expect(
      fs.readFile("/repo/.poe-code/ralph/plans/archive/plan-a.md", "utf8")
    ).rejects.toThrow();
  });

  it("does not delete a plan when confirmation is declined", async () => {
    confirmOrCancelMock.mockResolvedValueOnce(false);

    const writeSpy = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    const fs = createMemFs({
      "/repo/.poe-code/experiments/plan-a.md": "# Plan"
    });
    const container = createCliContainer({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: () => {}
    });
    const program = createBaseProgram();
    registerPlanCommand(program, container);

    await program.parseAsync([
      "node",
      "cli",
      "plan",
      "delete",
      ".poe-code/experiments/plan-a.md"
    ]);

    const output = writeSpy.mock.calls.map(([chunk]) => String(chunk)).join("");
    expect(output).toBe("");
    await expect(
      fs.readFile("/repo/.poe-code/experiments/plan-a.md", "utf8")
    ).resolves.toBe("# Plan");
  });
});
