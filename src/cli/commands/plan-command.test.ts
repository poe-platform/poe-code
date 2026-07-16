import { afterEach, describe, expect, it, vi } from "vitest";
import { Volume, createFsFromVolume } from "memfs";
import { Command } from "commander";
import { stripVTControlCharacters } from "node:util";
import { createCliContainer } from "../container.js";
import type { FileSystem } from "../../utils/file-system.js";
import { registerPlanCommand } from "./plan.js";

const {
  introMock,
  outroMock,
  selectMock,
  confirmOrCancelMock,
  isCancelMock
} = vi.hoisted(() => ({
  introMock: vi.fn(),
  outroMock: vi.fn(),
  selectMock: vi.fn(),
  confirmOrCancelMock: vi.fn().mockResolvedValue(true),
  isCancelMock: vi.fn(() => false)
}));

const { readMarkdownMock, readSectionMock, runMarkdownReaderMcpMock } = vi.hoisted(() => ({
  readMarkdownMock: vi.fn(),
  readSectionMock: vi.fn(),
  runMarkdownReaderMcpMock: vi.fn().mockResolvedValue(undefined)
}));

const { editPlanMock } = vi.hoisted(() => ({
  editPlanMock: vi.fn().mockResolvedValue({ changed: true })
}));

vi.mock("toolcraft-design", async (importOriginal) => {
  const actual = await importOriginal<typeof import("toolcraft-design")>();
  return {
    ...actual,
    intro: introMock,
    outro: outroMock,
    select: selectMock,
    confirmOrCancel: confirmOrCancelMock,
    isCancel: isCancelMock
  };
});

vi.mock("@poe-code/markdown-reader", () => ({
  readMarkdown: readMarkdownMock,
  readSection: readSectionMock,
  runMarkdownReaderMcp: runMarkdownReaderMcpMock
}));

vi.mock("@poe-code/plan-browser", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@poe-code/plan-browser")>();
  return {
    ...actual,
    editPlan: editPlanMock
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

function withMockedStdin<T>(run: () => Promise<T>, isTTY: boolean): Promise<T> {
  const stdinDescriptor = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");

  Object.defineProperty(process.stdin, "isTTY", {
    configurable: true,
    value: isTTY
  });

  return run().finally(() => {
    if (stdinDescriptor) {
      Object.defineProperty(process.stdin, "isTTY", stdinDescriptor);
    } else {
      Reflect.deleteProperty(process.stdin, "isTTY");
    }
  });
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
          "version: 1",
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
          "version: 1",
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
          "builder:",
          "  prompt: Build.",
          "superintendent:",
          "  prompt: Review.",
          "owner:",
          "  prompt: Approve.",
          "status:",
          "  state: in_progress",
          "  round: 0",
          "  review_turn: 0",
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
          "version: 1",
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
          "version: 1",
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

    selectMock.mockResolvedValue("/repo/docs/plans/plan-a.md");

    await withMockedStdin(
      () =>
        program.parseAsync([
          "node",
          "cli",
          "plan",
          "view",
          "--kind",
          "pipeline",
          "--output",
          "json"
        ]),
      true
    );

    expect(selectMock).toHaveBeenCalledWith(
      expect.objectContaining({
        options: [expect.objectContaining({ value: "/repo/docs/plans/plan-a.md" })]
      })
    );
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

  it("rejects plan selection in non-interactive mode and lists candidates", async () => {
    const container = createCliContainer({
      fs: createMemFs({
        "/repo/docs/plans/plan-a.md": "# Plan",
        "/repo/docs/plans/plan-b.md": "# Plan B"
      }),
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: () => {}
    });
    const program = createBaseProgram();
    registerPlanCommand(program, container);

    await expect(
      withMockedStdin(() => program.parseAsync(["node", "cli", "plan", "view"]), false)
    ).rejects.toThrow(/docs\/plans\/plan-a\.md[\s\S]*docs\/plans\/plan-b\.md/);

    expect(selectMock).not.toHaveBeenCalled();
  });

  it("refuses to archive without an explicit path even with --yes", async () => {
    const writeSpy = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    const fs = createMemFs({
      "/repo/docs/plans/plan-a.md": "# Plan",
      "/repo/docs/plans/plan-b.md": "# Plan B"
    });
    const container = createCliContainer({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir, variables: { EDITOR: "cat" } },
      logger: () => {}
    });
    const program = createBaseProgram();
    registerPlanCommand(program, container);

    await expect(program.parseAsync(["node", "cli", "--yes", "plan", "archive"])).rejects.toThrow(
      /docs\/plans\/plan-a\.md[\s\S]*docs\/plans\/plan-b\.md/
    );

    expect(writeSpy.mock.calls.map(([chunk]) => String(chunk)).join("")).not.toContain("Archived");
    await expect(fs.readFile("/repo/docs/plans/plan-a.md", "utf8")).resolves.toBe("# Plan");
    await expect(fs.readFile("/repo/docs/plans/archive/plan-a.md", "utf8")).rejects.toThrow();
  });

  it("refuses to delete without an explicit path even with --yes", async () => {
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

    await expect(program.parseAsync(["node", "cli", "--yes", "plan", "delete"])).rejects.toThrow(
      /docs\/plans\/plan-a\.md/
    );

    await expect(fs.readFile("/repo/docs/plans/plan-a.md", "utf8")).resolves.toBe("# Plan");
  });

  it("archives the named plan with --yes without confirming", async () => {
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

    await program.parseAsync(["node", "cli", "--yes", "plan", "archive", "docs/plans/plan-a.md"]);

    const output = writeSpy.mock.calls.map(([chunk]) => String(chunk)).join("");
    expect(output).toContain("Archived");
    await expect(fs.readFile("/repo/docs/plans/archive/plan-a.md", "utf8")).resolves.toBe("# Plan");
    expect(confirmOrCancelMock).not.toHaveBeenCalled();
  });

  it("previews editing a plan without launching an editor", async () => {
    const writeSpy = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    const container = createCliContainer({
      fs: createMemFs({
        "/repo/docs/plans/plan-a.md": "# Plan"
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
      "--dry-run",
      "--yes",
      "plan",
      "edit",
      "docs/plans/plan-a.md"
    ]);

    expect(editPlanMock).not.toHaveBeenCalled();
    expect(writeSpy.mock.calls.map(([chunk]) => String(chunk)).join("")).toContain("Would edit");
  });

  it("refuses to open an editor for plan edit without a TTY", async () => {
    editPlanMock.mockResolvedValue({ changed: true });
    const container = createCliContainer({
      fs: createMemFs({ "/repo/docs/plans/plan-a.md": "# Plan" }),
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: () => {}
    });
    const program = createBaseProgram();
    registerPlanCommand(program, container);

    await withMockedStdin(
      () =>
        expect(
          program.parseAsync(["node", "cli", "--yes", "plan", "edit", "docs/plans/plan-a.md"])
        ).rejects.toThrow(/interactive TTY/),
      false
    );

    expect(editPlanMock).not.toHaveBeenCalled();
  });

  it("frames an applied plan edit through the design system", async () => {
    editPlanMock.mockResolvedValue({ changed: true });
    const container = createCliContainer({
      fs: createMemFs({ "/repo/docs/plans/plan-a.md": "# Plan" }),
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: () => {}
    });
    const program = createBaseProgram();
    registerPlanCommand(program, container);

    await withMockedStdin(
      () =>
        program.parseAsync(["node", "cli", "--yes", "plan", "edit", "docs/plans/plan-a.md"]),
      true
    );

    expect(editPlanMock).toHaveBeenCalledOnce();
    expect(outroMock).toHaveBeenCalledWith(expect.stringContaining("Edited docs/plans/plan-a.md"));
  });

  it("reports no changes when the editor leaves the plan untouched", async () => {
    editPlanMock.mockResolvedValue({ changed: false });
    const container = createCliContainer({
      fs: createMemFs({ "/repo/docs/plans/plan-a.md": "# Plan" }),
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: () => {}
    });
    const program = createBaseProgram();
    registerPlanCommand(program, container);

    await withMockedStdin(
      () =>
        program.parseAsync(["node", "cli", "--yes", "plan", "edit", "docs/plans/plan-a.md"]),
      true
    );

    expect(outroMock).toHaveBeenCalledWith(expect.stringContaining("No changes"));
    expect(outroMock).not.toHaveBeenCalledWith(expect.stringContaining("Edited"));
  });

  it("reports the edit change state as json", async () => {
    editPlanMock.mockResolvedValue({ changed: false });
    const writeSpy = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    const container = createCliContainer({
      fs: createMemFs({ "/repo/docs/plans/plan-a.md": "# Plan" }),
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: () => {}
    });
    const program = createBaseProgram();
    registerPlanCommand(program, container);

    await withMockedStdin(
      () =>
        program.parseAsync([
          "node",
          "cli",
          "--yes",
          "plan",
          "edit",
          "docs/plans/plan-a.md",
          "--output",
          "json"
        ]),
      true
    );

    const output = writeSpy.mock.calls.map(([chunk]) => String(chunk)).join("");
    expect(JSON.parse(stripVTControlCharacters(output))).toEqual({
      action: "edit",
      path: "docs/plans/plan-a.md",
      changed: false
    });
  });

  it("previews archiving a plan without moving its file", async () => {
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
      "--dry-run",
      "--yes",
      "plan",
      "archive",
      "docs/plans/plan-a.md"
    ]);

    await expect(fs.readFile("/repo/docs/plans/plan-a.md", "utf8")).resolves.toBe("# Plan");
    await expect(fs.readFile("/repo/docs/plans/archive/plan-a.md", "utf8")).rejects.toThrow();
  });

  it("previews deleting a plan without removing its file", async () => {
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
      "--dry-run",
      "--yes",
      "plan",
      "delete",
      "docs/plans/plan-a.md"
    ]);

    await expect(fs.readFile("/repo/docs/plans/plan-a.md", "utf8")).resolves.toBe("# Plan");
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

    await withMockedStdin(
      () =>
        program.parseAsync([
          "node",
          "cli",
          "plan",
          "archive",
          "docs/plans/plan-a.md"
        ]),
      true
    );

    const output = writeSpy.mock.calls.map(([chunk]) => String(chunk)).join("");
    expect(output).toBe("");
    expect(confirmOrCancelMock).toHaveBeenCalledWith(
      expect.objectContaining({
        initialValue: false,
        message: "Archive plan-a.md?"
      })
    );
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

    await withMockedStdin(
      () =>
        program.parseAsync([
          "node",
          "cli",
          "plan",
          "delete",
          "docs/plans/plan-a.md"
        ]),
      true
    );

    const output = writeSpy.mock.calls.map(([chunk]) => String(chunk)).join("");
    expect(output).toBe("");
    expect(confirmOrCancelMock).toHaveBeenCalledWith(
      expect.objectContaining({
        initialValue: false,
        message: "Permanently delete plan-a.md?"
      })
    );
    await expect(fs.readFile("/repo/docs/plans/plan-a.md", "utf8")).resolves.toBe("# Plan");
  });

  it("rejects archive confirmation in non-interactive mode", async () => {
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

    await expect(
      withMockedStdin(
        () =>
          program.parseAsync([
            "node",
            "cli",
            "plan",
            "archive",
            "docs/plans/plan-a.md"
          ]),
        false
      )
    ).rejects.toThrow("plan archive requires --yes when running without an interactive TTY.");

    expect(writeSpy).not.toHaveBeenCalled();
    expect(confirmOrCancelMock).not.toHaveBeenCalled();
    await expect(fs.readFile("/repo/docs/plans/plan-a.md", "utf8")).resolves.toBe("# Plan");
    await expect(fs.readFile("/repo/docs/plans/archive/plan-a.md", "utf8")).rejects.toThrow();
  });

  it("returns parseable JSON instead of prompting for archive confirmation", async () => {
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
      "docs/plans/plan-a.md",
      "--output",
      "json"
    ]);

    const output = writeSpy.mock.calls.map(([chunk]) => String(chunk)).join("");
    expect(JSON.parse(output)).toEqual({
      action: "archive",
      path: "docs/plans/plan-a.md",
      confirmationRequired: true,
      skipped: true
    });
    expect(confirmOrCancelMock).not.toHaveBeenCalled();
    await expect(fs.readFile("/repo/docs/plans/plan-a.md", "utf8")).resolves.toBe("# Plan");
    await expect(fs.readFile("/repo/docs/plans/archive/plan-a.md", "utf8")).rejects.toThrow();
  });

  it("returns parseable JSON instead of prompting for delete confirmation", async () => {
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
      "docs/plans/plan-a.md",
      "--output",
      "json"
    ]);

    const output = writeSpy.mock.calls.map(([chunk]) => String(chunk)).join("");
    expect(JSON.parse(output)).toEqual({
      action: "delete",
      path: "docs/plans/plan-a.md",
      confirmationRequired: true,
      skipped: true
    });
    expect(confirmOrCancelMock).not.toHaveBeenCalled();
    await expect(fs.readFile("/repo/docs/plans/plan-a.md", "utf8")).resolves.toBe("# Plan");
  });

  it("reads markdown docs as a terminal TOC", async () => {
    readMarkdownMock.mockResolvedValueOnce({
      file: "docs/plans/markdown-reader.md",
      frontmatter: {},
      sections: [
        { number: "2", title: "User-facing shape", depth: 2 },
        { number: "2.1", title: "Command: plan markdown-read", depth: 3 }
      ]
    });

    const writeSpy = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    const container = createCliContainer({
      fs: createMemFs(),
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
      "markdown-read",
      "docs/plans/markdown-reader.md",
      "--depth",
      "3"
    ]);

    expect(readMarkdownMock).toHaveBeenCalledWith({
      file: "docs/plans/markdown-reader.md",
      depth: 3
    });

    const output = writeSpy.mock.calls.map(([chunk]) => String(chunk)).join("");
    expect(output).toContain("file: docs/plans/markdown-reader.md");
    expect(output).toContain("frontmatter:");
    expect(output).toContain("(none)");
    expect(output).toContain("sections:");
    expect(output).toContain("2.1    Command: plan markdown-read");
  });

  it("reads a markdown section with markdown output by default", async () => {
    readSectionMock.mockResolvedValueOnce({
      file: "docs/plans/markdown-reader.md",
      section: {
        number: "2.1",
        title: "Command: plan markdown-read",
        depth: 3
      },
      markdown: "### Command: `plan markdown-read`\n\nBody.\n"
    });

    const writeSpy = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    const container = createCliContainer({
      fs: createMemFs(),
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
      "markdown-read-section",
      "docs/plans/markdown-reader.md",
      "2.1",
      "--no-include-children"
    ]);

    expect(readSectionMock).toHaveBeenCalledWith({
      file: "docs/plans/markdown-reader.md",
      section: "2.1",
      includeChildren: false
    });

    const output = writeSpy.mock.calls.map(([chunk]) => String(chunk)).join("");
    expect(output).toContain("### Command: `plan markdown-read`");
    expect(output).toContain("Body.");
  });

  it("runs the standalone markdown reader MCP server", async () => {
    const container = createCliContainer({
      fs: createMemFs(),
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: () => {}
    });
    const program = createBaseProgram();
    registerPlanCommand(program, container);

    await program.parseAsync(["node", "cli", "plan", "markdown-reader-mcp"]);

    expect(runMarkdownReaderMcpMock).toHaveBeenCalledTimes(1);
  });
});
