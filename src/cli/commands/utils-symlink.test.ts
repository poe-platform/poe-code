import { createFsFromVolume, Volume } from "memfs";
import { describe, expect, it } from "vitest";
import type { FileSystem } from "../../utils/file-system.js";
import { planAgentsSymlink } from "./utils-symlink-agents.js";
import {
  applySymlinkOps,
  type SymlinkOp
} from "./utils-symlink-ops.js";

const cwd = "/repo";

function createMemFs(files: Record<string, string> = {}): FileSystem {
  const volume = Volume.fromJSON(files, "/");
  volume.mkdirSync(cwd, { recursive: true });
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
