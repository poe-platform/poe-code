import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Volume, createFsFromVolume } from "memfs";
import type { FileSystem } from "../utils/file-system.js";
import { ValidationError } from "../errors.js";

const { selectMock, cancelMock } = vi.hoisted(() => {
  return {
    selectMock: vi.fn(),
    cancelMock: vi.fn()
  };
});

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

const cwd = "/repo";
const homeDir = "/home/test";

function createMemFs(): { fs: FileSystem; vol: Volume } {
  const vol = new Volume();
  vol.mkdirSync(homeDir, { recursive: true });
  vol.mkdirSync(cwd, { recursive: true });
  const fs = createFsFromVolume(vol).promises as unknown as FileSystem;
  return { fs, vol };
}

const stdinIsTTYDescriptor = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");

function setProcessStdinIsTTY(value: boolean): () => void {
  Object.defineProperty(process.stdin, "isTTY", {
    value,
    configurable: true
  });

  return restoreProcessStdinIsTTY;
}

function restoreProcessStdinIsTTY(): void {
  if (stdinIsTTYDescriptor) {
    Object.defineProperty(process.stdin, "isTTY", stdinIsTTYDescriptor);
  } else {
    Reflect.deleteProperty(process.stdin, "isTTY");
  }
}

// ---------------------------------------------------------------------------
// skill-unconfigure-command.test.ts
// ---------------------------------------------------------------------------

describe("skill unconfigure command", () => {
  beforeEach(() => {
    setProcessStdinIsTTY(true);
  });

  afterEach(() => {
    restoreProcessStdinIsTTY();
    vi.restoreAllMocks();
    selectMock.mockReset();
    cancelMock.mockReset();
  });

  it("rejects an unknown agent", async () => {
    const { fs } = createMemFs();
    const logs: string[] = [];

    const program = createProgram({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: (message) => {
        logs.push(message);
      },
      suppressCommanderOutput: true
    });

    await expect(
      program.parseAsync(["node", "cli", "skill", "unconfigure", "unknown"])
    ).rejects.toThrow(/^Unknown agent "unknown"\. Agents supporting skill: /);
    expect(logs.join("\n")).not.toContain("Unknown agent");
  });

  it("rejects conflicting unconfigure scopes", async () => {
    const { fs } = createMemFs();
    const program = createProgram({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: () => {},
      suppressCommanderOutput: true
    });

    await expect(
      program.parseAsync(["node", "cli", "skill", "unconfigure", "claude-code", "--local", "--global"])
    ).rejects.toEqual(new ValidationError("Use either --local or --global, not both."));
  });

  it("prompts for unconfigure agent despite core.defaultAgent when --yes is absent", async () => {
    const { fs, vol } = createMemFs();
    const logs: string[] = [];

    vol.mkdirSync(`${homeDir}/.codex/skills`, { recursive: true });
    vol.mkdirSync(`${homeDir}/.claude/skills`, { recursive: true });
    selectMock.mockResolvedValueOnce("claude-code");

    const program = createProgram({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: (message) => {
        logs.push(message);
      },
      suppressCommanderOutput: true
    });
    await fs.mkdir(`${homeDir}/.poe-code`, { recursive: true });
    await fs.writeFile(
      `${homeDir}/.poe-code/config.json`,
      `${JSON.stringify({ core: { defaultAgent: "codex:openai/gpt-5.4" } }, null, 2)}
`,
      "utf8"
    );

    await program.parseAsync(["node", "cli", "skill", "unconfigure", "--global", "--force"]);

    expect(selectMock).toHaveBeenCalledTimes(1);
    expect(selectMock).toHaveBeenCalledWith(
      expect.objectContaining({ message: "Select agent to unconfigure:" })
    );
    expect(logs).toContain("Removed poe-code skills for claude-code at ~/.claude/skills");
    await expect(fs.stat(`${homeDir}/.claude/skills`)).rejects.toThrow("ENOENT");
    await expect(fs.stat(`${homeDir}/.codex/skills`)).resolves.toBeDefined();
  });

  it("uses core.defaultAgent for --yes unconfigure and drops the model portion", async () => {
    const { fs, vol } = createMemFs();
    const logs: string[] = [];

    vol.mkdirSync(`${homeDir}/.codex/skills`, { recursive: true });

    const program = createProgram({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: (message) => {
        logs.push(message);
      },
      suppressCommanderOutput: true
    });
    await fs.mkdir(`${homeDir}/.poe-code`, { recursive: true });
    await fs.writeFile(
      `${homeDir}/.poe-code/config.json`,
      `${JSON.stringify({ core: { defaultAgent: "codex:openai/gpt-5.4" } }, null, 2)}
`,
      "utf8"
    );

    await program.parseAsync(["node", "cli", "--yes", "skill", "unconfigure", "--global", "--force"]);

    expect(selectMock).not.toHaveBeenCalled();
    expect(logs).toContain("Removed poe-code skills for codex at ~/.codex/skills");
    await expect(fs.stat(`${homeDir}/.codex/skills`)).rejects.toThrow("ENOENT");
  });

  it("does not recover malformed config while previewing skill unconfigure", async () => {
    const { fs } = createMemFs();
    const malformedConfig = "{ invalid json\n";
    await fs.mkdir(`${homeDir}/.poe-code`, { recursive: true });
    await fs.writeFile(`${homeDir}/.poe-code/config.json`, malformedConfig, "utf8");
    const program = createProgram({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: () => {},
      suppressCommanderOutput: true
    });

    await expect(
      program.parseAsync(["node", "cli", "--dry-run", "--yes", "skill", "unconfigure", "--local"])
    ).rejects.toThrow();

    await expect(fs.readFile(`${homeDir}/.poe-code/config.json`, "utf8")).resolves.toBe(malformedConfig);
    await expect(fs.readdir(`${homeDir}/.poe-code`)).resolves.toEqual(["config.json"]);
  });

  it("uses default agent and scope for root --yes unconfigure", async () => {
    const { fs } = createMemFs();
    const logs: string[] = [];

    const program = createProgram({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: (message) => logs.push(message),
      suppressCommanderOutput: true
    });

    await program.parseAsync(["node", "cli", "--yes", "--dry-run", "skill", "unconfigure"]);

    expect(selectMock).not.toHaveBeenCalled();
    expect(logs).toContain("Would remove poe-code skills for claude-code at ~/.claude/skills");
  });

  it("warns when directory has files and --force is not set", async () => {
    const { fs, vol } = createMemFs();
    const logs: string[] = [];

    vol.mkdirSync(`${homeDir}/.claude/skills`, { recursive: true });
    await fs.writeFile(`${homeDir}/.claude/skills/a.txt`, "hello", "utf8");

    const program = createProgram({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: (message) => {
        logs.push(message);
      },
      suppressCommanderOutput: true
    });

    await program.parseAsync(["node", "cli", "skill", "unconfigure", "claude-code", "--global"]);

    expect(logs.some((line) => line.includes("skills poe-code does not manage"))).toBe(true);
    await expect(fs.stat(`${homeDir}/.claude/skills`)).resolves.toBeDefined();
    await expect(fs.readdir(`${homeDir}/.claude/skills`)).resolves.toContain("a.txt");
  });

  it("removes poe-code managed skills when --force is set", async () => {
    const { fs, vol } = createMemFs();
    const logs: string[] = [];

    vol.mkdirSync(`${homeDir}/.claude/skills`, { recursive: true });
    await fs.writeFile(`${homeDir}/.claude/skills/poe-generate.md`, "locally edited", "utf8");

    const program = createProgram({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: (message) => {
        logs.push(message);
      },
      suppressCommanderOutput: true
    });

    await program.parseAsync([
      "node",
      "cli",
      "skill",
      "unconfigure",
      "claude-code",
      "--global",
      "--force"
    ]);

    expect(logs).toContain("Removed poe-code skills for claude-code at ~/.claude/skills");
    await expect(fs.stat(`${homeDir}/.claude/skills`)).rejects.toThrow("ENOENT");
  });

  it("keeps unmanaged skills and the skills root when --force is set", async () => {
    const { fs, vol } = createMemFs();
    const logs: string[] = [];

    vol.mkdirSync(`${homeDir}/.claude/skills/poe-code-pipeline-plan`, { recursive: true });
    await fs.writeFile(`${homeDir}/.claude/skills/poe-generate.md`, "locally edited", "utf8");
    await fs.writeFile(
      `${homeDir}/.claude/skills/poe-code-pipeline-plan/SKILL.md`,
      "user authored",
      "utf8"
    );

    const program = createProgram({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: (message) => {
        logs.push(message);
      },
      suppressCommanderOutput: true
    });

    await program.parseAsync([
      "node",
      "cli",
      "skill",
      "unconfigure",
      "claude-code",
      "--global",
      "--force"
    ]);

    await expect(
      fs.readFile(`${homeDir}/.claude/skills/poe-code-pipeline-plan/SKILL.md`, "utf8")
    ).resolves.toBe("user authored");
    await expect(fs.stat(`${homeDir}/.claude/skills/poe-generate.md`)).rejects.toThrow("ENOENT");
    await expect(fs.stat(`${homeDir}/.claude/skills`)).resolves.toBeDefined();
    expect(logs).toContain("Removed poe-code skills for claude-code at ~/.claude/skills");
    expect(logs.some((line) => line.includes("No skill directory found"))).toBe(false);
  });

  it("prints the blast radius before removing skills", async () => {
    const { fs, vol } = createMemFs();
    const logs: string[] = [];

    vol.mkdirSync(`${homeDir}/.claude/skills`, { recursive: true });
    await fs.writeFile(`${homeDir}/.claude/skills/poe-generate.md`, "locally edited", "utf8");

    const program = createProgram({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: (message) => {
        logs.push(message);
      },
      suppressCommanderOutput: true
    });

    await program.parseAsync([
      "node",
      "cli",
      "skill",
      "unconfigure",
      "claude-code",
      "--global",
      "--force"
    ]);

    const blastRadiusIndex = logs.findIndex((line) => line.includes("poe-generate.md"));
    const summaryIndex = logs.findIndex((line) => line.includes("Removed poe-code skills"));
    expect(blastRadiusIndex).toBeGreaterThanOrEqual(0);
    expect(blastRadiusIndex).toBeLessThan(summaryIndex);
  });

  it("never reports a home directory path for --local dry-run", async () => {
    const { fs, vol } = createMemFs();
    const logs: string[] = [];

    vol.mkdirSync(`${cwd}/.claude/skills`, { recursive: true });
    await fs.writeFile(`${cwd}/.claude/skills/poe-generate.md`, "locally edited", "utf8");

    const program = createProgram({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: (message) => {
        logs.push(message);
      },
      suppressCommanderOutput: true
    });

    await program.parseAsync([
      "node",
      "cli",
      "--dry-run",
      "skill",
      "unconfigure",
      "claude-code",
      "--local",
      "--force"
    ]);

    expect(logs.filter((line) => line.includes("~/"))).toEqual([]);
    expect(logs.some((line) => line.includes(".claude/skills"))).toBe(true);
  });

  it("prompts for agent and scope when not provided", async () => {
    const { fs, vol } = createMemFs();
    const logs: string[] = [];

    vol.mkdirSync(`${homeDir}/.claude/skills`, { recursive: true });

    selectMock.mockResolvedValueOnce("claude-code").mockResolvedValueOnce("global");

    const program = createProgram({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: (message) => {
        logs.push(message);
      },
      suppressCommanderOutput: true
    });

    await program.parseAsync(["node", "cli", "skill", "unconfigure", "--force"]);

    expect(selectMock).toHaveBeenCalledTimes(2);
    expect(logs).toContain("Removed poe-code skills for claude-code at ~/.claude/skills");
    await expect(fs.stat(`${homeDir}/.claude/skills`)).rejects.toThrow("ENOENT");
  });

  it("rejects non-interactive unconfigure when scope must be selected", async () => {
    const restoreStdin = setProcessStdinIsTTY(false);
    const { fs } = createMemFs();

    const program = createProgram({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: () => {},
      suppressCommanderOutput: true
    });

    try {
      await expect(
        program.parseAsync(["node", "cli", "skill", "unconfigure", "claude-code", "--force"])
      ).rejects.toEqual(
        new ValidationError(
          "Skill scope selection requires --local, --global, or --yes when running without an interactive TTY."
        )
      );
    } finally {
      restoreStdin();
    }

    expect(selectMock).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// skill-configure-command.test.ts
// ---------------------------------------------------------------------------

describe("skill configure command", () => {
  beforeEach(() => {
    setProcessStdinIsTTY(true);
  });

  afterEach(() => {
    restoreProcessStdinIsTTY();
    vi.restoreAllMocks();
    selectMock.mockReset();
    cancelMock.mockReset();
  });

  it("rejects an unknown agent", async () => {
    const { fs } = createMemFs();
    const program = createProgram({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: () => {},
      suppressCommanderOutput: true
    });

    await expect(
      program.parseAsync(["node", "cli", "skill", "configure", "unknown", "--yes"])
    ).rejects.toThrow(/^Unknown agent "unknown"\. Agents supporting skill: /);
  });

  it("rejects conflicting configure scopes", async () => {
    const { fs } = createMemFs();
    const program = createProgram({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: () => {},
      suppressCommanderOutput: true
    });

    await expect(
      program.parseAsync(["node", "cli", "skill", "configure", "claude-code", "--local", "--global"])
    ).rejects.toEqual(new ValidationError("Use either --local or --global, not both."));
  });

  it("rejects another unknown configured agent value", async () => {
    const { fs } = createMemFs();
    const logs: string[] = [];

    const program = createProgram({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: (message) => {
        logs.push(message);
      },
      suppressCommanderOutput: true
    });

    await expect(
      program.parseAsync(["node", "cli", "skill", "configure", "invalid-provider"])
    ).rejects.toThrow(/^Unknown agent "invalid-provider"\. Agents supporting skill: /);
    expect(logs.join("\n")).not.toContain("Unknown agent");
  });

  it("configures skills for an agent and reports the target path", async () => {
    const { fs } = createMemFs();
    const logs: string[] = [];

    const program = createProgram({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: (message) => {
        logs.push(message);
      },
      suppressCommanderOutput: true
    });

    await program.parseAsync(["node", "cli", "skill", "configure", "claude-code", "--global"]);

    expect(logs).toContain("Configured skills for claude-code at ~/.claude/skills");
    await expect(fs.stat(`${homeDir}/.claude/skills`)).resolves.toBeDefined();
    await expect(fs.stat(`${homeDir}/.claude/skills/poe-generate.md`)).resolves.toBeDefined();
  });

  it("prompts for agent and scope when not provided", async () => {
    const { fs } = createMemFs();
    const logs: string[] = [];

    selectMock.mockResolvedValueOnce("claude-code").mockResolvedValueOnce("global");

    const program = createProgram({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: (message) => {
        logs.push(message);
      },
      suppressCommanderOutput: true
    });

    await program.parseAsync(["node", "cli", "skill", "configure"]);

    expect(selectMock).toHaveBeenCalledTimes(2);
    expect(logs).toContain("Configured skills for claude-code at ~/.claude/skills");
    await expect(fs.stat(`${homeDir}/.claude/skills/poe-generate.md`)).resolves.toBeDefined();
  });

  it("rejects non-interactive configure when agent must be selected", async () => {
    const restoreStdin = setProcessStdinIsTTY(false);
    const { fs } = createMemFs();

    const program = createProgram({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: () => {},
      suppressCommanderOutput: true
    });

    try {
      await expect(program.parseAsync(["node", "cli", "skill", "configure", "--local"]))
        .rejects.toEqual(
          new ValidationError(
            "Skill agent selection requires an agent or --yes when running without an interactive TTY."
          )
        );
    } finally {
      restoreStdin();
    }

    expect(selectMock).not.toHaveBeenCalled();
  });

  it("rejects non-interactive configure when scope must be selected", async () => {
    const restoreStdin = setProcessStdinIsTTY(false);
    const { fs } = createMemFs();

    const program = createProgram({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: () => {},
      suppressCommanderOutput: true
    });

    try {
      await expect(program.parseAsync(["node", "cli", "skill", "configure", "claude-code"]))
        .rejects.toEqual(
          new ValidationError(
            "Skill scope selection requires --local, --global, or --yes when running without an interactive TTY."
          )
        );
    } finally {
      restoreStdin();
    }

    expect(selectMock).not.toHaveBeenCalled();
  });

  it("prompts for configure agent despite core.defaultAgent when --yes is absent", async () => {
    const { fs } = createMemFs();
    const logs: string[] = [];
    selectMock.mockResolvedValueOnce("claude-code");

    const program = createProgram({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: (message) => {
        logs.push(message);
      },
      suppressCommanderOutput: true
    });
    await fs.mkdir(`${homeDir}/.poe-code`, { recursive: true });
    await fs.writeFile(
      `${homeDir}/.poe-code/config.json`,
      `${JSON.stringify({ core: { defaultAgent: "codex:openai/gpt-5.4" } }, null, 2)}
`,
      "utf8"
    );

    await program.parseAsync(["node", "cli", "skill", "configure", "--local"]);

    expect(selectMock).toHaveBeenCalledTimes(1);
    expect(selectMock).toHaveBeenCalledWith(
      expect.objectContaining({ message: "Select agent to configure:" })
    );
    expect(logs).toContain("Configured skills for claude-code at ./.claude/skills");
    await expect(fs.stat(`${cwd}/.claude/skills/poe-generate.md`)).resolves.toBeDefined();
    await expect(fs.stat(`${cwd}/.codex/skills/poe-generate.md`)).rejects.toThrow("ENOENT");
  });

  it("uses core.defaultAgent for --yes configure and drops the model portion", async () => {
    const { fs } = createMemFs();
    const logs: string[] = [];

    const program = createProgram({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: (message) => {
        logs.push(message);
      },
      suppressCommanderOutput: true
    });
    await fs.mkdir(`${homeDir}/.poe-code`, { recursive: true });
    await fs.writeFile(
      `${homeDir}/.poe-code/config.json`,
      `${JSON.stringify({ core: { defaultAgent: "codex:openai/gpt-5.4" } }, null, 2)}
`,
      "utf8"
    );

    await program.parseAsync(["node", "cli", "--yes", "skill", "configure", "--local"]);

    expect(selectMock).not.toHaveBeenCalled();
    expect(logs).toContain("Configured skills for codex at ./.codex/skills");
    await expect(fs.stat(`${cwd}/.codex/skills/poe-generate.md`)).resolves.toBeDefined();
  });

  it("explains the goose skill directory so the shared .agents path is not a surprise", async () => {
    const { fs } = createMemFs();
    const logs: string[] = [];

    const program = createProgram({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: (message) => {
        logs.push(message);
      },
      suppressCommanderOutput: true
    });

    await program.parseAsync(["node", "cli", "skill", "configure", "goose", "--local", "--yes"]);

    expect(logs).toContain("Configured skills for goose at ./.agents/skills");
    expect(logs).toContain(
      "Goose discovers skills from the shared .agents/skills convention, not a goose-specific directory."
    );
  });

  it("omits the directory note for agents that use their own agent directory", async () => {
    const { fs } = createMemFs();
    const logs: string[] = [];

    const program = createProgram({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: (message) => {
        logs.push(message);
      },
      suppressCommanderOutput: true
    });

    await program.parseAsync(["node", "cli", "skill", "configure", "claude", "--local", "--yes"]);

    expect(logs).toContain("Configured skills for claude-code at ./.claude/skills");
    expect(logs.some((line) => line.includes("convention"))).toBe(false);
  });

  it("does not recover malformed config while previewing skill configure", async () => {
    const { fs } = createMemFs();
    const malformedConfig = "{ invalid json\n";
    await fs.mkdir(`${homeDir}/.poe-code`, { recursive: true });
    await fs.writeFile(`${homeDir}/.poe-code/config.json`, malformedConfig, "utf8");
    const program = createProgram({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: () => {},
      suppressCommanderOutput: true
    });

    await expect(
      program.parseAsync(["node", "cli", "--dry-run", "--yes", "skill", "configure", "--local"])
    ).rejects.toThrow();

    await expect(fs.readFile(`${homeDir}/.poe-code/config.json`, "utf8")).resolves.toBe(malformedConfig);
    await expect(fs.readdir(`${homeDir}/.poe-code`)).resolves.toEqual(["config.json"]);
  });

  it("uses defaults with --yes and does not prompt", async () => {
    const { fs } = createMemFs();
    const logs: string[] = [];

    const program = createProgram({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: (message) => {
        logs.push(message);
      },
      suppressCommanderOutput: true
    });

    await program.parseAsync(["node", "cli", "--yes", "skill", "configure"]);

    expect(selectMock).not.toHaveBeenCalled();
    expect(logs).toContain("Configured skills for claude-code at ~/.claude/skills");
    await expect(fs.stat(`${homeDir}/.claude/skills/poe-generate.md`)).resolves.toBeDefined();
  });

  it("announces the default agent and scope that --yes selected", async () => {
    const { fs } = createMemFs();
    const logs: string[] = [];

    const program = createProgram({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: (message) => {
        logs.push(message);
      },
      suppressCommanderOutput: true
    });

    await program.parseAsync(["node", "cli", "--yes", "skill", "configure"]);

    const output = logs.join("\n");
    expect(output).toContain("Using default agent: claude-code (built-in default");
    expect(output).toContain("Using default scope: global");
  });

  it("does not announce a default scope when --local is explicit", async () => {
    const { fs } = createMemFs();
    const logs: string[] = [];

    const program = createProgram({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: (message) => {
        logs.push(message);
      },
      suppressCommanderOutput: true
    });

    await program.parseAsync(["node", "cli", "--yes", "skill", "configure", "--local"]);

    const output = logs.join("\n");
    expect(output).toContain("Using default agent: claude-code (built-in default");
    expect(output).not.toContain("Using default scope");
  });

  it("does not announce a default agent when the agent is explicit", async () => {
    const { fs } = createMemFs();
    const logs: string[] = [];

    const program = createProgram({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: (message) => {
        logs.push(message);
      },
      suppressCommanderOutput: true
    });

    await program.parseAsync(["node", "cli", "--yes", "skill", "configure", "codex", "--local"]);

    expect(logs.join("\n")).not.toContain("Using default agent");
  });

  it("prompts for agent when --local is provided and reports local path", async () => {
    const { fs } = createMemFs();
    const logs: string[] = [];

    selectMock.mockResolvedValueOnce("claude-code");

    const program = createProgram({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: (message) => {
        logs.push(message);
      },
      suppressCommanderOutput: true
    });

    await program.parseAsync(["node", "cli", "skill", "configure", "--local"]);

    expect(selectMock).toHaveBeenCalledTimes(1);
    expect(logs).toContain("Configured skills for claude-code at ./.claude/skills");
    await expect(fs.stat(`${cwd}/.claude/skills/poe-generate.md`)).resolves.toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// skill-list-command.test.ts
// ---------------------------------------------------------------------------

describe("skill list command", () => {
  beforeEach(() => {
    setProcessStdinIsTTY(true);
  });

  afterEach(() => {
    restoreProcessStdinIsTTY();
    vi.restoreAllMocks();
    selectMock.mockReset();
    cancelMock.mockReset();
  });

  it("lists installed skills when invoked bare, without printing help", async () => {
    const { fs, vol } = createMemFs();
    const logs: string[] = [];

    vol.mkdirSync(`${cwd}/.claude/skills/project-skill`, { recursive: true });
    vol.writeFileSync(`${cwd}/.claude/skills/project-skill/SKILL.md`, "# project\n");

    const program = createProgram({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: (message) => {
        logs.push(message);
      },
      suppressCommanderOutput: true
    });

    await program.parseAsync(["node", "cli", "skill"]);

    const output = logs.join("\n");
    expect(output).toContain("claude-code/project-skill");
    expect(output).not.toContain("Usage: poe-code skill");
    expect(selectMock).not.toHaveBeenCalled();
  });

  it("lists installed skills for an agent in both scopes", async () => {
    const { fs, vol } = createMemFs();
    const logs: string[] = [];

    vol.mkdirSync(`${cwd}/.claude/skills/project-skill`, { recursive: true });
    vol.writeFileSync(`${cwd}/.claude/skills/project-skill/SKILL.md`, "# project\n");
    vol.writeFileSync(`${cwd}/.claude/skills/README.md`, "not a skill\n");
    vol.mkdirSync(`${homeDir}/.claude/skills/user-skill`, { recursive: true });
    vol.writeFileSync(`${homeDir}/.claude/skills/user-skill/SKILL.md`, "# user\n");

    const program = createProgram({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: (message) => {
        logs.push(message);
      },
      suppressCommanderOutput: true
    });

    await program.parseAsync(["node", "cli", "skill", "list", "claude-code"]);

    const output = logs.join("\n");
    expect(output).toContain("claude-code/project-skill");
    expect(output).toContain("claude-code/user-skill");
    expect(output).not.toContain("README");
    expect(selectMock).not.toHaveBeenCalled();
  });

  it("filters by scope when --global is passed", async () => {
    const { fs, vol } = createMemFs();
    const logs: string[] = [];

    vol.mkdirSync(`${cwd}/.claude/skills/project-skill`, { recursive: true });
    vol.mkdirSync(`${homeDir}/.claude/skills/user-skill`, { recursive: true });

    const program = createProgram({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: (message) => {
        logs.push(message);
      },
      suppressCommanderOutput: true
    });

    await program.parseAsync(["node", "cli", "skill", "list", "claude-code", "--global"]);

    const output = logs.join("\n");
    expect(output).toContain("claude-code/user-skill");
    expect(output).not.toContain("project-skill");
  });

  it("lists every skill-capable agent when no agent is given", async () => {
    const { fs, vol } = createMemFs();
    const logs: string[] = [];

    vol.mkdirSync(`${cwd}/.claude/skills/claude-skill`, { recursive: true });
    vol.mkdirSync(`${homeDir}/.codex/skills/codex-skill`, { recursive: true });

    const program = createProgram({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: (message) => {
        logs.push(message);
      },
      suppressCommanderOutput: true
    });

    await program.parseAsync(["node", "cli", "skill", "list"]);

    const output = logs.join("\n");
    expect(output).toContain("claude-code/claude-skill");
    expect(output).toContain("codex/codex-skill");
    expect(selectMock).not.toHaveBeenCalled();
  });

  it("reports where it looked when nothing is installed", async () => {
    const { fs } = createMemFs();
    const logs: string[] = [];

    const program = createProgram({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: (message) => {
        logs.push(message);
      },
      suppressCommanderOutput: true
    });

    await program.parseAsync(["node", "cli", "skill", "list", "claude-code"]);

    const output = logs.join("\n");
    expect(output).toContain("No skills installed for claude-code");
    expect(output).toContain("- .claude/skills");
    expect(output).toContain("- ~/.claude/skills");
  });

  it("rejects an unknown agent", async () => {
    const { fs } = createMemFs();

    const program = createProgram({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: () => {},
      suppressCommanderOutput: true
    });

    await expect(program.parseAsync(["node", "cli", "skill", "list", "unknown"])).rejects.toThrow(
      /^Unknown agent "unknown"\. Agents supporting skill: /
    );
  });
});

// ---------------------------------------------------------------------------
// skill-install-command.test.ts
// ---------------------------------------------------------------------------

describe("skill install command", () => {
  beforeEach(() => {
    setProcessStdinIsTTY(true);
  });

  afterEach(() => {
    restoreProcessStdinIsTTY();
    vi.restoreAllMocks();
    selectMock.mockReset();
    cancelMock.mockReset();
  });

  it("installs arbitrary skill content from a source file", async () => {
    const { fs } = createMemFs();
    const logs: string[] = [];

    await fs.mkdir(`${cwd}/.agents/skills/poe-agent-tools`, { recursive: true });
    await fs.writeFile(
      `${cwd}/.agents/skills/poe-agent-tools/SKILL.md`,
      "# Poe Agent Tools\n",
      "utf8"
    );

    const program = createProgram({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: (message) => {
        logs.push(message);
      },
      suppressCommanderOutput: true
    });

    await program.parseAsync([
      "node",
      "cli",
      "skill",
      "install",
      "codex",
      "--local",
      "--name",
      "poe-agent-tools",
      "--file",
      ".agents/skills/poe-agent-tools/SKILL.md",
      "--yes"
    ]);

    expect(logs).toContain(
      "Installed skill poe-agent-tools for codex at .codex/skills/poe-agent-tools/SKILL.md"
    );
    await expect(
      fs.readFile(`${cwd}/.codex/skills/poe-agent-tools/SKILL.md`, "utf8")
    ).resolves.toBe("# Poe Agent Tools\n");
  });
});
