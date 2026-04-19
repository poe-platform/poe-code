import { createFsFromVolume, Volume } from "memfs";
import { describe, expect, it } from "vitest";
import type { FileSystem } from "../../utils/file-system.js";
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
    }
  ];

  it.each(cases)("$name", async ({ setup, expected }) => {
    const fs = createMemFs();
    await setup?.(fs);

    await expect(planSkillsSymlink(fs, targets)).resolves.toEqual(expected);
  });
});

describe("applySymlinkOps", () => {
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
