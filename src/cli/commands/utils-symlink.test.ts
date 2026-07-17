import { createFsFromVolume, Volume } from "memfs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { text } from "toolcraft-design";
import type { FileSystem } from "../../utils/file-system.js";

const { selectMock, cancelMock } = vi.hoisted(() => ({
  selectMock: vi.fn(),
  cancelMock: vi.fn()
}));

vi.mock("toolcraft-design", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("toolcraft-design");
  return {
    ...actual,
    select: selectMock,
    isCancel: (value: unknown) => value === "__cancel__",
    cancel: cancelMock
  };
});

import { createProgram } from "../program.js";
import { planAgentsSymlink } from "./utils-symlink-agents.js";
import {
  planSkillsSymlink,
  resolveSkillsTargets,
  type SkillsTargets
} from "./utils-symlink-skills.js";
import {
  applySymlinkOps,
  type SymlinkOp
} from "./utils-symlink-ops.js";

const cwd = "/repo";
const homeDir = "/home/u";

const localTargets: SkillsTargets = {
  claudeDir: "/repo/.claude/skills",
  agentsDir: "/repo/.agents/skills",
  relativeTargetFromClaude: "../.agents/skills"
};

const globalTargets: SkillsTargets = {
  claudeDir: "/home/u/.claude/skills",
  agentsDir: "/home/u/.agents/skills",
  relativeTargetFromClaude: "../.agents/skills"
};

function createMemFs(files: Record<string, string> = {}): FileSystem {
  const volume = Volume.fromJSON(files, "/");
  volume.mkdirSync(cwd, { recursive: true });
  volume.mkdirSync(homeDir, { recursive: true });
  return createFsFromVolume(volume).promises as unknown as FileSystem;
}

function createCliProgram(fs: FileSystem, logs: string[]) {
  return createProgram({
    fs,
    prompts: vi.fn().mockResolvedValue({}),
    env: { cwd, homeDir },
    logger: (message) => {
      logs.push(message);
    },
    suppressCommanderOutput: true
  });
}

async function readRepoState(fs: FileSystem): Promise<Record<string, string>> {
  const names = (await fs.readdir(cwd)).slice().sort();
  const state: Record<string, string> = {};

  for (const name of names) {
    const path = `${cwd}/${name}`;
    const stats = await fs.lstat(path);

    if (stats.isSymbolicLink()) {
      state[name] = `symlink:${await fs.readlink(path)}`;
      continue;
    }

    if (stats.isFile()) {
      state[name] = `file:${await fs.readFile(path, "utf8")}`;
      continue;
    }

    state[name] = "other";
  }

  return state;
}

describe("planAgentsSymlink", () => {
  const cases: Array<{
    name: string;
    files?: Record<string, string>;
    setup?: (fs: FileSystem) => Promise<void>;
    expected: SymlinkOp[];
  }> = [
    {
      name: "returns rename and symlink when only CLAUDE.md exists",
      files: { [`${cwd}/CLAUDE.md`]: "claude" },
      expected: [
        { kind: "rename", from: `${cwd}/CLAUDE.md`, to: `${cwd}/AGENTS.md` },
        { kind: "symlink", target: "AGENTS.md", path: `${cwd}/CLAUDE.md` }
      ]
    },
    {
      name: "returns symlink when only AGENTS.md exists",
      files: { [`${cwd}/AGENTS.md`]: "agents" },
      expected: [{ kind: "symlink", target: "AGENTS.md", path: `${cwd}/CLAUDE.md` }]
    },
    {
      name: "returns noop when neither file exists",
      expected: [{ kind: "noop", reason: "no CLAUDE.md or AGENTS.md" }]
    },
    {
      name: "returns conflict when both files exist as regular files",
      files: { [`${cwd}/CLAUDE.md`]: "claude", [`${cwd}/AGENTS.md`]: "agents" },
      expected: [
        {
          kind: "conflict",
          message:
            "both CLAUDE.md and AGENTS.md exist as regular files. Resolve manually: diff the files, keep the one you want as AGENTS.md, then re-run this command."
        }
      ]
    },
    {
      name: "returns noop when CLAUDE.md already points to AGENTS.md",
      setup: async (fs) => {
        await fs.symlink("AGENTS.md", `${cwd}/CLAUDE.md`);
      },
      expected: [{ kind: "noop", reason: "already linked" }]
    },
    {
      name: "returns conflict when CLAUDE.md is a symlink pointing elsewhere",
      setup: async (fs) => {
        await fs.symlink("docs/CLAUDE.md", `${cwd}/CLAUDE.md`);
      },
      expected: [
        {
          kind: "conflict",
          message: "CLAUDE.md is already a symlink to docs/CLAUDE.md. Remove it or repoint it manually."
        }
      ]
    },
    {
      name: "returns symlink when AGENTS.md is itself a symlink and CLAUDE.md is missing",
      setup: async (fs) => {
        await fs.symlink("../shared/AGENTS.md", `${cwd}/AGENTS.md`);
      },
      expected: [{ kind: "symlink", target: "AGENTS.md", path: `${cwd}/CLAUDE.md` }]
    },
    {
      name: "returns conflict when CLAUDE.md is a directory",
      setup: async (fs) => {
        await fs.mkdir(`${cwd}/CLAUDE.md`, { recursive: true });
      },
      expected: [
        {
          kind: "conflict",
          message:
            "CLAUDE.md exists but is not a regular file. Resolve manually: move or remove it, then re-run this command."
        }
      ]
    }
  ];

  it.each(cases)("$name", async ({ files, setup, expected }) => {
    const fs = createMemFs(files);
    await setup?.(fs);

    await expect(planAgentsSymlink(fs, cwd)).resolves.toEqual(expected);
  });
});

describe("resolveSkillsTargets", () => {
  it("resolves local scope from cwd", () => {
    expect(resolveSkillsTargets("local", { cwd, homeDir })).toEqual(localTargets);
  });

  it("resolves global scope from homeDir", () => {
    expect(resolveSkillsTargets("global", { cwd, homeDir })).toEqual(globalTargets);
  });

  it("uses the same relative target for both scopes", () => {
    expect(resolveSkillsTargets("local", { cwd, homeDir }).relativeTargetFromClaude).toBe(
      "../.agents/skills"
    );
    expect(resolveSkillsTargets("global", { cwd, homeDir }).relativeTargetFromClaude).toBe(
      "../.agents/skills"
    );
  });
});

describe.each([
  { name: "local", targets: localTargets },
  { name: "global", targets: globalTargets }
])("planSkillsSymlink ($name)", ({ targets }) => {
  const cases: Array<{
    name: string;
    setup?: (fs: FileSystem) => Promise<void>;
    expected: SymlinkOp[];
  }> = [
    {
      name: "returns rename and symlink when only claude dir exists",
      setup: async (fs) => {
        await fs.mkdir(targets.claudeDir, { recursive: true });
      },
      expected: [
        { kind: "rename", from: targets.claudeDir, to: targets.agentsDir },
        {
          kind: "symlink",
          target: targets.relativeTargetFromClaude,
          path: targets.claudeDir
        }
      ]
    },
    {
      name: "returns symlink when only agents dir exists",
      setup: async (fs) => {
        await fs.mkdir(targets.agentsDir, { recursive: true });
      },
      expected: [
        {
          kind: "symlink",
          target: targets.relativeTargetFromClaude,
          path: targets.claudeDir
        }
      ]
    },
    {
      name: "returns noop when neither dir exists",
      expected: [{ kind: "noop", reason: "no .claude/skills found — nothing to do" }]
    },
    {
      name: "returns conflict when both dirs exist",
      setup: async (fs) => {
        await fs.mkdir(targets.claudeDir, { recursive: true });
        await fs.mkdir(targets.agentsDir, { recursive: true });
      },
      expected: [
        {
          kind: "conflict",
          message:
            "both .claude/skills and .agents/skills exist. Resolve manually: move the files you want to keep into .agents/skills, remove .claude/skills, then re-run this command."
        }
      ]
    },
    {
      name: "returns noop when claude dir is already linked",
      setup: async (fs) => {
        await fs.mkdir(targets.claudeDir.split("/").slice(0, -1).join("/"), {
          recursive: true
        });
        await fs.symlink(targets.relativeTargetFromClaude, targets.claudeDir);
      },
      expected: [{ kind: "noop", reason: "already linked" }]
    },
    {
      name: "returns conflict when claude dir is a symlink pointing elsewhere",
      setup: async (fs) => {
        await fs.mkdir(targets.claudeDir.split("/").slice(0, -1).join("/"), {
          recursive: true
        });
        await fs.symlink("../shared/skills", targets.claudeDir);
      },
      expected: [
        {
          kind: "conflict",
          message:
            ".claude/skills is already a symlink to ../shared/skills. Remove it or repoint it manually."
        }
      ]
    },
    {
      name: "returns conflict when claude skills path is a regular file",
      setup: async (fs) => {
        await fs.mkdir(targets.claudeDir.split("/").slice(0, -1).join("/"), {
          recursive: true
        });
        await fs.writeFile(targets.claudeDir, "not a directory", { encoding: "utf8" });
      },
      expected: [
        {
          kind: "conflict",
          message:
            ".claude/skills exists but is not a directory. Resolve manually: move or remove it, then re-run this command."
        }
      ]
    }
  ];

  it.each(cases)("$name", async ({ setup, expected }) => {
    const fs = createMemFs();
    await setup?.(fs);

    await expect(planSkillsSymlink(fs, targets)).resolves.toEqual(expected);
  });
});

describe("applySymlinkOps", () => {
  it("rolls back a completed rename when a following symlink creation fails", async () => {
    const rawFs = createMemFs({ [`${cwd}/CLAUDE.md`]: "instructions\n" });
    const fs = {
      ...rawFs,
      symlink: async () => {
        throw new Error("simulated symlink creation failure");
      }
    } as FileSystem;

    await expect(
      applySymlinkOps(
        fs,
        [
          { kind: "rename", from: `${cwd}/CLAUDE.md`, to: `${cwd}/AGENTS.md` },
          { kind: "symlink", target: "AGENTS.md", path: `${cwd}/CLAUDE.md` }
        ],
        { dryRun: false, log: () => undefined }
      )
    ).rejects.toThrow("simulated symlink creation failure");

    await expect(rawFs.readFile(`${cwd}/CLAUDE.md`, "utf8")).resolves.toBe("instructions\n");
    await expect(rawFs.lstat(`${cwd}/AGENTS.md`)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("reports both the operation failure and rollback failure", async () => {
    const rawFs = createMemFs({ [`${cwd}/CLAUDE.md`]: "instructions\n" });
    const fs = {
      ...rawFs,
      rename: async (from, to) => {
        if (from === `${cwd}/CLAUDE.md` && to === `${cwd}/AGENTS.md`) {
          await rawFs.rename(from, to);
          return;
        }

        throw new Error("simulated rollback failure");
      },
      symlink: async () => {
        throw new Error("simulated symlink creation failure");
      }
    } as FileSystem;

    let failure: unknown;
    try {
      await applySymlinkOps(
        fs,
        [
          { kind: "rename", from: `${cwd}/CLAUDE.md`, to: `${cwd}/AGENTS.md` },
          { kind: "symlink", target: "AGENTS.md", path: `${cwd}/CLAUDE.md` }
        ],
        { dryRun: false, log: () => undefined }
      );
    } catch (error) {
      failure = error;
    }

    expect(failure).toBeInstanceOf(AggregateError);
    expect((failure as AggregateError).errors).toHaveLength(2);
    expect((failure as AggregateError).errors[0]).toMatchObject({
      message: "simulated symlink creation failure"
    });
    expect((failure as AggregateError).errors[1]).toMatchObject({
      message: "simulated rollback failure"
    });
  });
});

describe("utils symlink help", () => {
  const findSymlink = (fs: FileSystem) => {
    const program = createCliProgram(fs, []);
    const utils = program.commands.find((c) => c.name() === "utils");
    return { utils, symlink: utils?.commands.find((c) => c.name() === "symlink") };
  };

  it("renders through the shared design-system help formatter", () => {
    const { utils, symlink } = findSymlink(createMemFs());

    expect(symlink?.configureHelp().formatHelp).toBe(utils?.configureHelp().formatHelp);
  });

  it("documents its options and commands with design-system styling", () => {
    const originalForceColor = process.env.FORCE_COLOR;
    process.env.FORCE_COLOR = "1";

    try {
      const { symlink } = findSymlink(createMemFs());
      symlink?.configureOutput({ getOutHasColors: () => true });
      const help = symlink?.helpInformation() ?? "";

      expect(help).toContain(text.heading("Poe - utils symlink"));
      expect(help).toContain(text.section("Usage:"));
      expect(help).toContain(text.section("Options:"));
      expect(help).toContain("-h, --help");
      expect(help).toContain(text.section("Commands:"));
      expect(help).toContain(text.command("agents [options]"));
      expect(help).toContain(text.command("skills [options]"));
    } finally {
      if (originalForceColor === undefined) delete process.env.FORCE_COLOR;
      else process.env.FORCE_COLOR = originalForceColor;
    }
  });
});

describe("utils symlink subcommand help", () => {
  it.each(["agents", "skills"])("%s --help shows its own flags, not the parent help", (sub) => {
    const fs = createMemFs();
    const program = createCliProgram(fs, []);
    const symlink = program.commands
      .find((c) => c.name() === "utils")
      ?.commands.find((c) => c.name() === "symlink");
    const subCmd = symlink?.commands.find((c) => c.name() === sub);
    const help = subCmd?.helpInformation() ?? "";
    expect(help).toContain("--dry-run");
    expect(help).not.toContain("Poe - utils symlink");
  });
});

describe("utils symlink skills command", () => {
  beforeEach(() => {
    selectMock.mockReset();
    cancelMock.mockReset();
    process.exitCode = undefined;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.exitCode = undefined;
  });

  it("runs the skills command through the utils symlink-skills alias", async () => {
    const fs = createMemFs();
    const logs: string[] = [];
    const lstatSpy = vi.spyOn(fs, "lstat");
    const program = createCliProgram(fs, logs);

    await program.parseAsync(["node", "cli", "utils", "symlink-skills", "--global"]);

    const checkedPaths = lstatSpy.mock.calls.map(([path]) => path);
    expect(checkedPaths).toContain(globalTargets.claudeDir);
    expect(checkedPaths).toContain(globalTargets.agentsDir);
    expect(process.exitCode).toBe(0);
  });

  it("errors when both --local and --global are passed", async () => {
    const fs = createMemFs();
    const logs: string[] = [];
    const program = createCliProgram(fs, logs);

    await program.parseAsync([
      "node",
      "cli",
      "utils",
      "symlink",
      "skills",
      "--local",
      "--global"
    ]);

    expect(logs).toContain("Use either --local or --global, not both.");
    expect(process.exitCode).toBe(1);
    expect(selectMock).not.toHaveBeenCalled();
  });

  it("uses local targets when --local is passed", async () => {
    const fs = createMemFs();
    const logs: string[] = [];
    const lstatSpy = vi.spyOn(fs, "lstat");
    const program = createCliProgram(fs, logs);

    await program.parseAsync(["node", "cli", "utils", "symlink", "skills", "--local"]);

    const checkedPaths = lstatSpy.mock.calls.map(([path]) => path);
    expect(checkedPaths).toContain(localTargets.claudeDir);
    expect(checkedPaths).toContain(localTargets.agentsDir);
    expect(checkedPaths).not.toContain(globalTargets.claudeDir);
    expect(checkedPaths).not.toContain(globalTargets.agentsDir);
    expect(selectMock).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(0);
  });

  it("uses global targets when --global is passed", async () => {
    const fs = createMemFs();
    const logs: string[] = [];
    const lstatSpy = vi.spyOn(fs, "lstat");
    const program = createCliProgram(fs, logs);

    await program.parseAsync(["node", "cli", "utils", "symlink", "skills", "--global"]);

    const checkedPaths = lstatSpy.mock.calls.map(([path]) => path);
    expect(checkedPaths).toContain(globalTargets.claudeDir);
    expect(checkedPaths).toContain(globalTargets.agentsDir);
    expect(checkedPaths).not.toContain(localTargets.claudeDir);
    expect(checkedPaths).not.toContain(localTargets.agentsDir);
    expect(selectMock).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(0);
  });

  it("defaults to global scope when --yes is passed without a scope flag", async () => {
    const fs = createMemFs();
    const logs: string[] = [];
    const lstatSpy = vi.spyOn(fs, "lstat");
    const program = createCliProgram(fs, logs);

    await program.parseAsync(["node", "cli", "utils", "symlink", "skills", "--yes"]);

    const checkedPaths = lstatSpy.mock.calls.map(([path]) => path);
    expect(checkedPaths).toContain(globalTargets.claudeDir);
    expect(checkedPaths).toContain(globalTargets.agentsDir);
    expect(checkedPaths).not.toContain(localTargets.claudeDir);
    expect(checkedPaths).not.toContain(localTargets.agentsDir);
    expect(selectMock).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(0);
  });

  it("prompts for scope and uses global targets when select returns global", async () => {
    const stdoutDescriptor = Object.getOwnPropertyDescriptor(process.stdout, "isTTY");
    const stdinDescriptor = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");

    Object.defineProperty(process.stdout, "isTTY", {
      configurable: true,
      value: false
    });
    Object.defineProperty(process.stdin, "isTTY", {
      configurable: true,
      value: true
    });

    try {
      selectMock.mockResolvedValueOnce("global");

      const fs = createMemFs();
      const logs: string[] = [];
      const lstatSpy = vi.spyOn(fs, "lstat");
      const program = createCliProgram(fs, logs);

      await program.parseAsync(["node", "cli", "utils", "symlink", "skills"]);

      const checkedPaths = lstatSpy.mock.calls.map(([path]) => path);
      expect(checkedPaths).toContain(globalTargets.claudeDir);
      expect(checkedPaths).toContain(globalTargets.agentsDir);
      expect(checkedPaths).not.toContain(localTargets.claudeDir);
      expect(checkedPaths).not.toContain(localTargets.agentsDir);
      expect(selectMock).toHaveBeenCalledWith({
        message: "Select scope:",
        options: [
          { value: "global", label: "Global" },
          { value: "local", label: "Local" }
        ]
      });
      expect(process.exitCode).toBe(0);
    } finally {
      if (stdoutDescriptor) {
        Object.defineProperty(process.stdout, "isTTY", stdoutDescriptor);
      }
      if (stdinDescriptor) {
        Object.defineProperty(process.stdin, "isTTY", stdinDescriptor);
      }
    }
  });

  it("refuses to prompt for scope in non-interactive mode", async () => {
    const stdinDescriptor = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");
    Object.defineProperty(process.stdin, "isTTY", {
      configurable: true,
      value: false
    });

    const fs = createMemFs();
    const logs: string[] = [];
    const lstatSpy = vi.spyOn(fs, "lstat");
    const program = createCliProgram(fs, logs);

    try {
      await program.parseAsync(["node", "cli", "utils", "symlink", "skills"]);
    } finally {
      if (stdinDescriptor) {
        Object.defineProperty(process.stdin, "isTTY", stdinDescriptor);
      } else {
        Reflect.deleteProperty(process.stdin, "isTTY");
      }
    }

    expect(logs).toContain(
      "utils symlink skills requires --local, --global, or --yes when running without an interactive TTY."
    );
    expect(process.exitCode).toBe(1);
    expect(selectMock).not.toHaveBeenCalled();
    expect(lstatSpy).not.toHaveBeenCalled();
  });
});

describe("applySymlinkOps", () => {
  it("creates missing parent directories when applying skills rename and symlink ops", async () => {
    const fs = createMemFs();
    await fs.mkdir(localTargets.claudeDir, { recursive: true });
    await fs.writeFile(`${localTargets.claudeDir}/example.md`, "skill", { encoding: "utf8" });
    const logs: string[] = [];
    const ops = await planSkillsSymlink(fs, localTargets);

    await expect(
      applySymlinkOps(fs, ops, {
        dryRun: false,
        log: (message) => logs.push(message)
      })
    ).resolves.toEqual({ conflicts: 0 });

    expect(await fs.readFile(`${localTargets.agentsDir}/example.md`, "utf8")).toBe("skill");
    expect((await fs.lstat(localTargets.claudeDir)).isSymbolicLink()).toBe(true);
    expect(await fs.readlink(localTargets.claudeDir)).toBe(localTargets.relativeTargetFromClaude);
    expect(logs).toEqual([
      "rename /repo/.claude/skills -> /repo/.agents/skills",
      "symlink /repo/.claude/skills -> ../.agents/skills"
    ]);
  });

  it("creates the missing legacy parent before symlinking existing agents skills", async () => {
    const fs = createMemFs();
    await fs.mkdir(localTargets.agentsDir, { recursive: true });
    await fs.writeFile(`${localTargets.agentsDir}/example.md`, "skill", { encoding: "utf8" });
    const logs: string[] = [];
    const ops = await planSkillsSymlink(fs, localTargets);

    await expect(
      applySymlinkOps(fs, ops, {
        dryRun: false,
        log: (message) => logs.push(message)
      })
    ).resolves.toEqual({ conflicts: 0 });

    expect((await fs.lstat(localTargets.claudeDir)).isSymbolicLink()).toBe(true);
    expect(await fs.readlink(localTargets.claudeDir)).toBe(localTargets.relativeTargetFromClaude);
    expect(await fs.readFile(`${localTargets.claudeDir}/example.md`, "utf8")).toBe("skill");
    expect(logs).toEqual(["symlink /repo/.claude/skills -> ../.agents/skills"]);
  });

  it("does not mutate the filesystem during dry run and logs each op", async () => {
    const fs = createMemFs({ [`${cwd}/CLAUDE.md`]: "claude" });
    const before = await readRepoState(fs);
    const logs: string[] = [];
    const ops: SymlinkOp[] = [
      { kind: "rename", from: `${cwd}/CLAUDE.md`, to: `${cwd}/AGENTS.md` },
      { kind: "symlink", target: "AGENTS.md", path: `${cwd}/CLAUDE.md` },
      { kind: "noop", reason: "already linked" }
    ];

    await expect(
      applySymlinkOps(fs, ops, {
        dryRun: true,
        log: (message) => logs.push(message)
      })
    ).resolves.toEqual({ conflicts: 0 });

    expect(await readRepoState(fs)).toEqual(before);
    expect(logs).toHaveLength(3);
  });

  it("applies rename, symlink, and noop ops during a real run", async () => {
    const fs = createMemFs({ [`${cwd}/CLAUDE.md`]: "claude" });
    const logs: string[] = [];
    const ops: SymlinkOp[] = [
      { kind: "rename", from: `${cwd}/CLAUDE.md`, to: `${cwd}/AGENTS.md` },
      { kind: "symlink", target: "AGENTS.md", path: `${cwd}/CLAUDE.md` },
      { kind: "noop", reason: "already linked" }
    ];

    await expect(
      applySymlinkOps(fs, ops, {
        dryRun: false,
        log: (message) => logs.push(message)
      })
    ).resolves.toEqual({ conflicts: 0 });

    expect(await readRepoState(fs)).toEqual({
      "AGENTS.md": "file:claude",
      "CLAUDE.md": "symlink:AGENTS.md"
    });
    expect(logs).toHaveLength(3);
  });

  it("increments conflict count and leaves the filesystem unchanged for conflict ops", async () => {
    const fs = createMemFs({
      [`${cwd}/CLAUDE.md`]: "claude",
      [`${cwd}/AGENTS.md`]: "agents"
    });
    const before = await readRepoState(fs);
    const logs: string[] = [];

    await expect(
      applySymlinkOps(
        fs,
        [
          {
            kind: "conflict",
            message:
              "both CLAUDE.md and AGENTS.md exist as regular files. Resolve manually: diff the files, keep the one you want as AGENTS.md, then re-run this command."
          }
        ],
        {
          dryRun: false,
          log: (message) => logs.push(message)
        }
      )
    ).resolves.toEqual({ conflicts: 1 });

    expect(await readRepoState(fs)).toEqual(before);
    expect(logs).toEqual([
      "both CLAUDE.md and AGENTS.md exist as regular files. Resolve manually: diff the files, keep the one you want as AGENTS.md, then re-run this command."
    ]);
  });
});
