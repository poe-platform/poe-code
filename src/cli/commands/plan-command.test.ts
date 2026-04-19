import { afterEach, describe, expect, it, vi } from "vitest";
import { Volume, createFsFromVolume } from "memfs";
import { Command } from "commander";
import { stripVTControlCharacters } from "node:util";
import { createCliContainer } from "../container.js";
import type { FileSystem } from "../../utils/file-system.js";
import { registerPlanCommand } from "./plan.js";

const {
  introMock,
  selectMock,
  confirmOrCancelMock,
  isCancelMock
} = vi.hoisted(() => ({
  introMock: vi.fn(),
  selectMock: vi.fn(),
  confirmOrCancelMock: vi.fn().mockResolvedValue(true),
  isCancelMock: vi.fn(() => false)
}));

vi.mock("@poe-code/design-system", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@poe-code/design-system")>();
  return {
    ...actual,
    intro: introMock,
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
        "/repo/docs/plans/plan-a.md": [
          "---",
          "kind: pipeline",
          "tasks:",
          "  - id: first",
          "    title: First",
          "    prompt: First prompt",
          "    status: open",
          "---"
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
        kind: "pipeline",
        type: "Pipeline",
        runner: "pipeline",
        name: "plan-a.md",
        detail: "0/1 done"
      })
    ]);
    expect(introMock).not.toHaveBeenCalled();
  });

  it("renders kind and type columns in terminal list output", async () => {
    const writeSpy = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    const container = createCliContainer({
      fs: createMemFs({
        "/repo/docs/plans/feature-design.md": "# Feature design\n"
      }),
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: () => {}
    });
    const program = createBaseProgram();
    registerPlanCommand(program, container);

    await program.parseAsync(["node", "cli", "plan", "list"]);

    const output = stripVTControlCharacters(
      writeSpy.mock.calls.map(([chunk]) => String(chunk)).join("")
    );
    expect(output).toContain("Kind");
    expect(output).toContain("Type");
    expect(output).toContain("Detail");
    expect(output).not.toContain("Source");
  });

  it("filters list output by kind", async () => {
    const writeSpy = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    const container = createCliContainer({
      fs: createMemFs({
        "/repo/docs/plans/plan-a.md": [
          "---",
          "kind: pipeline",
          "tasks:",
          "  - id: first",
          "    title: First",
          "    prompt: First prompt",
          "    status: open",
          "---"
        ].join("\n"),
        "/repo/docs/plans/plan-b.md": [
          "---",
          "kind: ralph",
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
      "--kind",
      "pipeline",
      "--output",
      "json"
    ]);

    const output = writeSpy.mock.calls.map(([chunk]) => String(chunk)).join("");
    expect(JSON.parse(output)).toEqual([
      expect.objectContaining({
        kind: "pipeline",
        type: "Pipeline",
        name: "plan-a.md"
      })
    ]);
  });

  it("supports filtering generic plan and superintendent docs by kind", async () => {
    const writeSpy = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    const container = createCliContainer({
      fs: createMemFs({
        "/repo/docs/plans/feature-design.md": "# Feature design\n",
        "/repo/docs/plans/pi-mono.md": [
          "---",
          "kind: superintendent",
          "version: 1",
          "---",
          "# Pi mono integration"
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
      "--kind",
      "superintendent",
      "--output",
      "json"
    ]);

    const superintendentOutput = writeSpy.mock.calls.map(([chunk]) => String(chunk)).join("");
    expect(JSON.parse(superintendentOutput)).toEqual([
      expect.objectContaining({
        kind: "superintendent",
        type: "Superintendent",
        name: "pi-mono.md"
      })
    ]);

    writeSpy.mockClear();

    await program.parseAsync([
      "node",
      "cli",
      "plan",
      "list",
      "--kind",
      "plan",
      "--output",
      "json"
    ]);

    const planOutput = writeSpy.mock.calls.map(([chunk]) => String(chunk)).join("");
    expect(JSON.parse(planOutput)).toEqual([
      expect.objectContaining({
        kind: "plan",
        type: "Plan",
        name: "feature-design.md"
      })
    ]);
  });

  it("renders a pipeline plan preview", async () => {
    const writeSpy = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    const container = createCliContainer({
      fs: createMemFs({
        "/repo/docs/plans/plan-a.md": [
          "---",
          "kind: pipeline",
          "tasks:",
          "  - id: first",
          "    title: First task",
          "    prompt: Ship it",
          "    status: done",
          "---"
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
      "docs/plans/plan-a.md"
    ]);

    const output = writeSpy.mock.calls.map(([chunk]) => String(chunk)).join("");
    expect(output).toContain("plan-a.md");
    expect(output).toContain("First task");
  });

  it("uses the kind filter for plan view selection", async () => {
    const writeSpy = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    const container = createCliContainer({
      fs: createMemFs({
        "/repo/docs/plans/plan-a.md": [
          "---",
          "kind: pipeline",
          "tasks:",
          "  - id: first",
          "    title: Pipeline task",
          "    prompt: Ship it",
          "    status: open",
          "---"
        ].join("\n"),
        "/repo/docs/plans/plan-b.md": [
          "---",
          "kind: ralph",
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
      "--kind",
      "pipeline",
      "--output",
      "json"
    ]);

    const output = writeSpy.mock.calls.map(([chunk]) => String(chunk)).join("");
    expect(JSON.parse(output)).toEqual(
      expect.objectContaining({
        kind: "pipeline",
        type: "Pipeline",
        runner: "pipeline",
        path: "docs/plans/plan-a.md"
      })
    );
  });

  it("archives the first matching plan with --yes", async () => {
    const writeSpy = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    const fs = createMemFs({
      "/repo/docs/plans/plan-a.md": "# Plan"
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
    await expect(fs.readFile("/repo/docs/plans/archive/plan-a.md", "utf8")).resolves.toBe("# Plan");
    expect(confirmOrCancelMock).not.toHaveBeenCalled();
  });

  it("does not archive a plan when confirmation is declined", async () => {
    confirmOrCancelMock.mockResolvedValueOnce(false);

    const writeSpy = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    const fs = createMemFs({
      "/repo/docs/plans/plan-a.md": "# Plan"
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
      "docs/plans/plan-a.md"
    ]);

    const output = writeSpy.mock.calls.map(([chunk]) => String(chunk)).join("");
    expect(output).toBe("");
    await expect(fs.readFile("/repo/docs/plans/plan-a.md", "utf8")).resolves.toBe("# Plan");
    await expect(fs.readFile("/repo/docs/plans/archive/plan-a.md", "utf8")).rejects.toThrow();
  });

  it("does not delete a plan when confirmation is declined", async () => {
    confirmOrCancelMock.mockResolvedValueOnce(false);

    const writeSpy = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    const fs = createMemFs({
      "/repo/docs/plans/plan-a.md": "# Plan"
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
      "docs/plans/plan-a.md"
    ]);

    const output = writeSpy.mock.calls.map(([chunk]) => String(chunk)).join("");
    expect(output).toBe("");
    await expect(fs.readFile("/repo/docs/plans/plan-a.md", "utf8")).resolves.toBe("# Plan");
  });
});
