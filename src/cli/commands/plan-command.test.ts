import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Volume, createFsFromVolume } from "memfs";
import { Command } from "commander";
import { stripVTControlCharacters } from "node:util";
import { UserError } from "toolcraft";
import { loadPlanPreviewMarkdown } from "@poe-code/plan-browser";
import { createCliContainer } from "../container.js";
import { createProgram } from "../program.js";
import type { FileSystem } from "../../utils/file-system.js";
import { isUserFacingError, OperationCancelledError, ValidationError } from "../errors.js";
import { registerPlanCommand } from "./plan.js";

const { introMock, outroMock, selectMock, confirmOrCancelMock } = vi.hoisted(() => ({
  introMock: vi.fn(),
  outroMock: vi.fn(),
  selectMock: vi.fn(),
  confirmOrCancelMock: vi.fn().mockResolvedValue(true)
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
    confirmOrCancel: confirmOrCancelMock
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
    editPlan: editPlanMock,
    loadPlanPreviewMarkdown: vi.fn(actual.loadPlanPreviewMarkdown)
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

  describe("archived plan read commands", () => {
    let program: Command;
    let outputChunks: string[];

    beforeEach(() => {
      outputChunks = [];
      vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
        outputChunks.push(String(chunk));
        return true;
      });
      program = createProgram({
        fs: createMemFs({
          "/repo/docs/plans/active.md": "# Active plan\n",
          "/repo/docs/plans/archive/archived.md": "# Archived plan\n"
        }),
        prompts: vi.fn().mockResolvedValue({}),
        env: { cwd, homeDir, variables: {} },
        logger: () => {}
      });
    });

    describe.each([
      {
        placement: "parent --archived",
        parentArgs: ["--archived"],
        localArgs: [],
        selectedPath: "docs/plans/archive/archived.md",
        excludedPath: "docs/plans/active.md"
      },
      {
        placement: "post-subcommand --archived",
        parentArgs: [],
        localArgs: ["--archived"],
        selectedPath: "docs/plans/archive/archived.md",
        excludedPath: "docs/plans/active.md"
      },
      {
        placement: "active default",
        parentArgs: [],
        localArgs: [],
        selectedPath: "docs/plans/active.md",
        excludedPath: "docs/plans/archive/archived.md"
      }
    ])("$placement", ({ parentArgs, localArgs, selectedPath, excludedPath }) => {
      it("lists only plans from the selected scope", async () => {
        await program.parseAsync([
          "node",
          "cli",
          "plan",
          ...parentArgs,
          "list",
          ...localArgs,
          "--output",
          "json"
        ]);

        expect(JSON.parse(outputChunks.join(""))).toEqual([
          expect.objectContaining({ path: selectedPath })
        ]);
        expect(introMock).not.toHaveBeenCalled();
      });

      it("views a plan from the selected scope", async () => {
        await program.parseAsync([
          "node",
          "cli",
          "plan",
          ...parentArgs,
          "view",
          selectedPath,
          ...localArgs,
          "--output",
          "json"
        ]);

        expect(JSON.parse(outputChunks.join(""))).toEqual(
          expect.objectContaining({ path: selectedPath })
        );
        expect(introMock).not.toHaveBeenCalled();
      });

      it("rejects a plan outside the selected scope", async () => {
        await expect(
          program.parseAsync([
            "node",
            "cli",
            "plan",
            ...parentArgs,
            "view",
            excludedPath,
            ...localArgs,
            "--output",
            "json"
          ])
        ).rejects.toThrow(`Plan not found: ${excludedPath}`);

        expect(outputChunks).toEqual([]);
      });
    });

    it.each(["list", "view"])("advertises --archived in plan %s help", async (command) => {
      await expect(
        program.parseAsync(["node", "cli", "plan", command, "--help"])
      ).rejects.toMatchObject({ code: "commander.helpDisplayed", exitCode: 0 });

      const help = stripVTControlCharacters(outputChunks.join(""));
      expect(help).toContain("Global Options");
      expect(help).toContain("--archived");
      expect(help).toContain("Browse archived plans instead of active plans");
    });
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

  it("reports an empty state instead of table chrome when no plans match", async () => {
    const writeSpy = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    const container = createCliContainer({
      fs: createMemFs(),
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: () => {}
    });
    const program = createBaseProgram();
    registerPlanCommand(program, container);

    await program.parseAsync(["node", "cli", "plan", "list", "--kind", "experiment"]);

    const output = stripVTControlCharacters(
      writeSpy.mock.calls.map(([chunk]) => String(chunk)).join("")
    );
    expect(output).toContain("No experiment plans found.");
    expect(output).not.toContain("Create one");
    expect(output).not.toContain("<description>");
    expect(output).not.toContain("Kind");
    expect(output).not.toContain("Updated");
  });

  it("still lists an empty plan set as an empty json array", async () => {
    const writeSpy = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    const container = createCliContainer({
      fs: createMemFs(),
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: () => {}
    });
    const program = createBaseProgram();
    registerPlanCommand(program, container);

    await program.parseAsync(["node", "cli", "plan", "list", "--output", "json"]);

    const output = writeSpy.mock.calls.map(([chunk]) => String(chunk)).join("");
    expect(JSON.parse(output)).toEqual([]);
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

    await program.parseAsync(["node", "cli", "plan", "list", "--kind", "plan", "--output", "json"]);

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

    await program.parseAsync(["node", "cli", "plan", "view", "docs/plans/plan-a.md"]);

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

  describe.each(["plan", "plans"])("%s missing-path selection", (alias) => {
    describe.each(["view", "edit", "archive", "unarchive", "delete"])("%s", (command) => {
      let program: Command;
      let volume: Volume;
      let initialFiles: ReturnType<Volume["toJSON"]>;
      let outputChunks: string[];

      beforeEach(() => {
        outputChunks = [];
        for (const stream of [process.stdout, process.stderr]) {
          vi.spyOn(stream, "write").mockImplementation((chunk) => {
            outputChunks.push(String(chunk));
            return true;
          });
        }
        volume = Volume.fromJSON({
          "/repo/docs/plans/active.md": "# Active plan\n",
          "/repo/docs/plans/archive/archived.md": "# Archived plan\n"
        });
        volume.mkdirSync(homeDir, { recursive: true });
        program = createProgram({
          fs: createFsFromVolume(volume).promises as unknown as FileSystem,
          prompts: vi.fn().mockResolvedValue({}),
          env: { cwd, homeDir },
          logger: () => {},
          exitOverride: true
        });
        initialFiles = volume.toJSON();
      });

      afterEach(() => {
        expect(volume.toJSON()).toEqual(initialFiles);
        expect(confirmOrCancelMock).not.toHaveBeenCalled();
        expect(editPlanMock).not.toHaveBeenCalled();
        expect(loadPlanPreviewMarkdown).not.toHaveBeenCalled();
        expect(outroMock).not.toHaveBeenCalled();
        expect(outputChunks).toEqual([]);
      });

      it("treats a cancelled selection as operation cancellation", async () => {
        selectMock.mockResolvedValueOnce(Symbol.for("poe.cancel"));

        await expect(
          withMockedStdin(() => program.parseAsync(["node", "cli", alias, command]), true)
        ).rejects.toBeInstanceOf(OperationCancelledError);

        expect(selectMock).toHaveBeenCalledExactlyOnceWith(
          expect.objectContaining({
            options: [
              expect.objectContaining({
                value:
                  command === "unarchive"
                    ? "/repo/docs/plans/archive/archived.md"
                    : "/repo/docs/plans/active.md"
              })
            ]
          })
        );
      });

      it("keeps an unmatched selection as a validation error", async () => {
        selectMock.mockResolvedValueOnce("/repo/docs/plans/missing.md");

        await expect(
          withMockedStdin(() => program.parseAsync(["node", "cli", alias, command]), true)
        ).rejects.toBeInstanceOf(ValidationError);

        expect(selectMock).toHaveBeenCalledOnce();
      });

      it.each([
        { mode: "non-TTY", isTTY: false, flags: [] },
        { mode: "--yes", isTTY: true, flags: ["--yes"] }
      ])("requires a path in $mode mode without prompting", async ({ isTTY, flags }) => {
        await expect(
          withMockedStdin(
            () => program.parseAsync(["node", "cli", ...flags, alias, command]),
            isTTY
          )
        ).rejects.toBeInstanceOf(ValidationError);

        expect(selectMock).not.toHaveBeenCalled();
      });
    });
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

    const error = await withMockedStdin(
      () => program.parseAsync(["node", "cli", "plan", "view"]),
      false
    ).catch((thrown: unknown) => thrown as Error);

    expect(error.message).toContain("docs/plans/plan-a.md");
    expect(error.message).toContain("docs/plans/plan-b.md");

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

    // Plans are listed newest-first, so their relative order depends on mtime.
    // Assert both candidates are listed without pinning the order.
    const error = await program
      .parseAsync(["node", "cli", "--yes", "plan", "archive"])
      .catch((thrown: unknown) => thrown as Error);

    expect(error.message).toContain("docs/plans/plan-a.md");
    expect(error.message).toContain("docs/plans/plan-b.md");

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

  it("unarchives the named plan with --yes", async () => {
    const writeSpy = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    const fs = createMemFs({
      "/repo/docs/plans/archive/plan-a.md": "# Plan"
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
      "--yes",
      "plan",
      "unarchive",
      "docs/plans/archive/plan-a.md"
    ]);

    expect(writeSpy.mock.calls.map(([chunk]) => String(chunk)).join("")).toContain("Unarchived");
    await expect(fs.readFile("/repo/docs/plans/plan-a.md", "utf8")).resolves.toBe("# Plan");
  });

  it("accepts --archived on plan browse", async () => {
    const fs = createMemFs({
      "/repo/docs/plans/active.md": "# Active",
      "/repo/docs/plans/archive/archived.md": "# Archived"
    });
    const container = createCliContainer({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: () => {}
    });
    const program = createBaseProgram();
    registerPlanCommand(program, container);

    const error = await withMockedStdin(
      () => program.parseAsync(["node", "cli", "plan", "browse", "--archived"]),
      false
    ).catch((thrown: unknown) => thrown as Error);

    expect(error.message).toContain("docs/plans/archive/archived.md");
    expect(error.message).not.toContain("docs/plans/active.md");
  });

  it("accepts --archived on the root plan command", async () => {
    const fs = createMemFs({
      "/repo/docs/plans/active.md": "# Active",
      "/repo/docs/plans/archive/archived.md": "# Archived"
    });
    const container = createCliContainer({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: () => {}
    });
    const program = createBaseProgram();
    registerPlanCommand(program, container);

    const error = await withMockedStdin(
      () => program.parseAsync(["node", "cli", "plan", "--archived"]),
      false
    ).catch((thrown: unknown) => thrown as Error);

    expect(error.message).toContain("docs/plans/archive/archived.md");
    expect(error.message).not.toContain("docs/plans/active.md");
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

    await withMockedStdin(async () => {
      await expect(
        program.parseAsync(["node", "cli", "--yes", "plan", "edit", "docs/plans/plan-a.md"])
      ).rejects.toThrow(/interactive TTY/);
    }, false);

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
      () => program.parseAsync(["node", "cli", "--yes", "plan", "edit", "docs/plans/plan-a.md"]),
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
      () => program.parseAsync(["node", "cli", "--yes", "plan", "edit", "docs/plans/plan-a.md"]),
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
    const stdout = vi.spyOn(process.stdout, "write").mockReturnValue(true);
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
    expect(stdout).toHaveBeenCalledWith("Would archive docs/plans/plan-a.md\n");
  });

  it("previews deleting a plan without removing its file", async () => {
    const stdout = vi.spyOn(process.stdout, "write").mockReturnValue(true);
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
    expect(stdout).toHaveBeenCalledWith("Would delete docs/plans/plan-a.md\n");
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
      () => program.parseAsync(["node", "cli", "plan", "archive", "docs/plans/plan-a.md"]),
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
      () => program.parseAsync(["node", "cli", "plan", "delete", "docs/plans/plan-a.md"]),
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
        () => program.parseAsync(["node", "cli", "plan", "archive", "docs/plans/plan-a.md"]),
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

  it("omits the plan body from json output by default", async () => {
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
          "---",
          "",
          "# Plan A body"
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
      "docs/plans/plan-a.md",
      "--output",
      "json"
    ]);

    const output = writeSpy.mock.calls.map(([chunk]) => String(chunk)).join("");
    const parsed = JSON.parse(output);
    expect(parsed).toEqual({
      kind: "pipeline",
      type: "Pipeline",
      runner: "pipeline",
      path: "docs/plans/plan-a.md",
      title: expect.any(String),
      detail: "1/1 done"
    });
    expect(parsed).not.toHaveProperty("content");
  });

  it("includes the plan body in json output with --include-content", async () => {
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
          "---",
          "",
          "# Plan A body"
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
      "docs/plans/plan-a.md",
      "--output",
      "json",
      "--include-content"
    ]);

    const output = writeSpy.mock.calls.map(([chunk]) => String(chunk)).join("");
    expect(JSON.parse(output).content).toContain("First task");
  });

  it("reports a missing markdown file the same way plan view reports a missing plan", async () => {
    readMarkdownMock.mockRejectedValueOnce(new UserError("file not found: missing.md"));

    const container = createCliContainer({
      fs: createMemFs(),
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: () => {}
    });
    const program = createBaseProgram();
    registerPlanCommand(program, container);

    const error = await program
      .parseAsync(["node", "cli", "plan", "markdown-read", "missing.md"])
      .then(
        () => undefined,
        (thrown: unknown) => thrown
      );

    expect(isUserFacingError(error)).toBe(true);
    expect((error as Error).message).toBe("File not found: missing.md");
  });

  it("reports a missing section as a clean user error", async () => {
    readSectionMock.mockRejectedValueOnce(
      new UserError(
        "no section matching \"nope\" (try 'poe-code plan markdown-read' to see the table of contents)"
      )
    );

    const container = createCliContainer({
      fs: createMemFs(),
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: () => {}
    });
    const program = createBaseProgram();
    registerPlanCommand(program, container);

    const error = await program
      .parseAsync(["node", "cli", "plan", "markdown-read-section", "doc.md", "nope"])
      .then(
        () => undefined,
        (thrown: unknown) => thrown
      );

    expect(isUserFacingError(error)).toBe(true);
    expect((error as Error).message).toBe(
      "No section matching \"nope\" (try 'poe-code plan markdown-read' to see the table of contents)"
    );
  });

  it("documents how to run and register the markdown reader MCP server", async () => {
    const container = createCliContainer({
      fs: createMemFs(),
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: () => {}
    });
    const program = createBaseProgram();
    registerPlanCommand(program, container);

    const mcpCommand = program.commands
      .find((command) => command.name() === "plan")!
      .commands.find((command) => command.name() === "markdown-reader-mcp")!;

    const helpChunks: string[] = [];
    mcpCommand.configureOutput({
      writeOut: (chunk) => {
        helpChunks.push(chunk);
      }
    });
    mcpCommand.outputHelp();

    const help = stripVTControlCharacters(helpChunks.join(""));

    expect(help).toContain("stdio");
    expect(help).toContain("poe-code plan markdown-reader-mcp");
    expect(help).toContain("mcpServers");
  });

  it("frames the terminal TOC with the design system instead of yaml-ish lines", async () => {
    readMarkdownMock.mockResolvedValueOnce({
      file: "docs/plans/markdown-reader.md",
      frontmatter: { kind: "plan" },
      sections: [{ number: "1", title: "What we're building", depth: 2 }]
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
      "docs/plans/markdown-reader.md"
    ]);

    const output = stripVTControlCharacters(
      writeSpy.mock.calls.map(([chunk]) => String(chunk)).join("")
    );

    // The old output was YAML-ish but not YAML: neither framed nor parseable.
    expect(output).not.toContain("file: docs/plans/markdown-reader.md");
    expect(output).not.toMatch(/^sections:$/m);
    expect(output).not.toMatch(/^frontmatter:$/m);

    expect(output).toContain("docs/plans/markdown-reader.md");
    expect(output).toContain("Sections");
    expect(output).toContain("What we're building");
    expect(output).toContain("Frontmatter");
    expect(output).toContain("kind");
    expect(output).toContain("plan");
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

    const output = stripVTControlCharacters(
      writeSpy.mock.calls.map(([chunk]) => String(chunk)).join("")
    );
    expect(output).toContain("docs/plans/markdown-reader.md");
    expect(output).toContain("Frontmatter");
    expect(output).toContain("(none)");
    expect(output).toContain("Sections");
    expect(output).toContain("2.1");
    expect(output).toContain("Command: plan markdown-read");
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
