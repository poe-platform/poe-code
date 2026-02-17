import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Volume, createFsFromVolume } from "memfs";
import path from "node:path";
import { Readable } from "node:stream";
import { createProgram } from "../program.js";
import { createCliContainer } from "../container.js";
import type { FileSystem } from "../utils/file-system.js";
import type {
  CommandRunner,
  CommandRunnerOptions,
  CommandRunnerResult
} from "../../utils/command-checks.js";

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

import { spawn as sdkSpawn } from "../../sdk/spawn.js";
import {
  buildSlug,
  buildResearchPrompt,
  buildResearchDocument,
  buildClonePath,
  extractRepoSlug,
  resolveGithubCloneUrl,
  resolveSource,
  buildOutputPath
} from "../../sdk/research.js";

const cwd = "/repo";
const homeDir = "/home/test";

function createMemFs(): FileSystem {
  const vol = new Volume();
  vol.mkdirSync(homeDir, { recursive: true });
  vol.mkdirSync(path.join(homeDir, ".poe-code"), { recursive: true });
  vol.mkdirSync(cwd, { recursive: true });
  return createFsFromVolume(vol).promises as unknown as FileSystem;
}

interface CommandCall {
  command: string;
  args: string[];
  options?: CommandRunnerOptions;
}

function createCommandRunnerStub(
  handler?: (
    command: string,
    args: string[],
    options?: CommandRunnerOptions
  ) => CommandRunnerResult | Promise<CommandRunnerResult>
): { runner: CommandRunner; calls: CommandCall[] } {
  const calls: CommandCall[] = [];
  const runner: CommandRunner = async (command, args, options) => {
    calls.push({ command, args, options });
    if (handler) {
      return await handler(command, args, options);
    }
    return { stdout: "", stderr: "", exitCode: 0 };
  };
  return { runner, calls };
}

function emptyAsyncIterable<T>(): AsyncIterable<T> {
  return (async function* () {})();
}

function fromArray<T>(items: readonly T[]): AsyncIterable<T> {
  return (async function* () {
    for (const item of items) {
      yield item;
    }
  })();
}

async function pathExists(fs: FileSystem, target: string): Promise<boolean> {
  try {
    await fs.stat(target);
    return true;
  } catch {
    return false;
  }
}

describe("research helpers", () => {
  it("builds a slug from prompts", () => {
    expect(buildSlug("Hello, world! / test")).toBe("hello-world-test");
  });

  it("trims long prompts", () => {
    const longPrompt = "a".repeat(80);
    const slug = buildSlug(longPrompt);
    expect(slug.length).toBe(48);
    expect(slug).toBe("a".repeat(48));
  });

  it("falls back for empty prompts", () => {
    expect(buildSlug("   ")).toBe("research");
  });

  it("prepends system instructions", () => {
    const prompt = "Explain the project";
    const output = buildResearchPrompt(prompt);
    expect(output).toContain("codebase research assistant");
    expect(output.endsWith(prompt)).toBe(true);
  });

  it("builds YAML frontmatter with optional fields", () => {
    const output = buildResearchDocument({
      prompt: "What is \"foo\"?\nLine2",
      agent: "codex",
      path: "/repo",
      github: "owner/repo",
      resumeCommand: "codex resume -C /repo thread_1",
      markdown: "Answer"
    });

    expect(output.startsWith("---\n")).toBe(true);
    expect(output).toContain(
      "research_prompt: \"What is \\\"foo\\\"?\\nLine2\""
    );
    expect(output).toContain("agent: \"codex\"");
    expect(output).toContain("path: \"/repo\"");
    expect(output).toContain("github: \"owner/repo\"");
    expect(output).toContain(
      "resume_session_cmd: \"codex resume -C /repo thread_1\""
    );
    expect(output).toContain("\n---\n\nAnswer");
  });

  it("omits optional YAML fields when missing", () => {
    const output = buildResearchDocument({
      prompt: "Hello",
      agent: "codex",
      path: "/repo",
      markdown: ""
    });

    expect(output.includes("github:")).toBe(false);
    expect(output.includes("resume_session_cmd:")).toBe(false);
  });

  it("builds deterministic clone paths", () => {
    expect(buildClonePath(homeDir, "owner/repo")).toBe(
      `${homeDir}/.poe-code/repos/owner-repo`
    );
  });

  it("extracts repo slugs from github inputs", () => {
    expect(extractRepoSlug("owner/repo")).toBe("owner-repo");
    expect(extractRepoSlug("ssh://git@github.com/owner/repo.git")).toBe(
      "owner-repo"
    );
    expect(extractRepoSlug("git@gh:o/r.git")).toBe("o-r");
  });

  it("resolves github clone URLs", () => {
    expect(resolveGithubCloneUrl("owner/repo")).toBe(
      "https://github.com/owner/repo.git"
    );
    expect(resolveGithubCloneUrl("git@gh:owner/repo.git")).toBe(
      "git@gh:owner/repo.git"
    );
    expect(resolveGithubCloneUrl("https://github.com/owner/repo.git")).toBe(
      "https://github.com/owner/repo.git"
    );
  });
});

describe("resolveSource", () => {
  it("clones github repos when missing", async () => {
    const fs = createMemFs();
    const { runner, calls } = createCommandRunnerStub();
    const container = createCliContainer({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      commandRunner: runner,
      logger: () => {}
    });
    const logger = container.loggerFactory.create({
      dryRun: false,
      verbose: false,
      scope: "test"
    });

    const result = await resolveSource({
      container,
      options: { github: "owner/repo" },
      logger
    });

    const clonePath = buildClonePath(homeDir, "owner/repo");
    expect(result.cwd).toBe(clonePath);
    expect(result.shouldCleanup).toBe(true);
    expect(calls[0]).toEqual({
      command: "git",
      args: [
        "clone",
        "--depth",
        "1",
        "https://github.com/owner/repo.git",
        clonePath
      ],
      options: undefined
    });
  });

  it("skips pull when repo has uncommitted changes", async () => {
    const fs = createMemFs();
    const clonePath = buildClonePath(homeDir, "owner/repo");
    await fs.mkdir(clonePath, { recursive: true });

    const { runner, calls } = createCommandRunnerStub((command, args) => {
      if (command === "git" && args[0] === "status") {
        return { stdout: " M file.txt\n", stderr: "", exitCode: 0 };
      }
      return { stdout: "", stderr: "", exitCode: 0 };
    });

    const container = createCliContainer({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      commandRunner: runner,
      logger: () => {}
    });
    const logger = container.loggerFactory.create({
      dryRun: false,
      verbose: false,
      scope: "test"
    });

    await resolveSource({
      container,
      options: { github: "owner/repo" },
      logger
    });

    const pulled = calls.some((call) => call.args[0] === "pull");
    const statusCalled = calls.some((call) => call.args[0] === "status");
    expect(statusCalled).toBe(true);
    expect(pulled).toBe(false);
  });

  it("pulls when repo is clean", async () => {
    const fs = createMemFs();
    const clonePath = buildClonePath(homeDir, "owner/repo");
    await fs.mkdir(clonePath, { recursive: true });

    const { runner, calls } = createCommandRunnerStub((command, args) => {
      if (command === "git" && args[0] === "status") {
        return { stdout: "", stderr: "", exitCode: 0 };
      }
      return { stdout: "", stderr: "", exitCode: 0 };
    });

    const container = createCliContainer({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      commandRunner: runner,
      logger: () => {}
    });
    const logger = container.loggerFactory.create({
      dryRun: false,
      verbose: false,
      scope: "test"
    });

    await resolveSource({
      container,
      options: { github: "owner/repo" },
      logger
    });

    const pulled = calls.some((call) => call.args[0] === "pull");
    expect(pulled).toBe(true);
  });

  it("resolves --path relative to cwd", async () => {
    const fs = createMemFs();
    const { runner } = createCommandRunnerStub();
    const container = createCliContainer({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      commandRunner: runner,
      logger: () => {}
    });
    const logger = container.loggerFactory.create({
      dryRun: false,
      verbose: false,
      scope: "test"
    });

    const result = await resolveSource({
      container,
      options: { path: "docs" },
      logger
    });

    expect(result.cwd).toBe(path.join(cwd, "docs"));
  });

  it("defaults to env cwd", async () => {
    const fs = createMemFs();
    const { runner } = createCommandRunnerStub();
    const container = createCliContainer({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      commandRunner: runner,
      logger: () => {}
    });
    const logger = container.loggerFactory.create({
      dryRun: false,
      verbose: false,
      scope: "test"
    });

    const result = await resolveSource({
      container,
      options: {},
      logger
    });

    expect(result.cwd).toBe(cwd);
  });
});

describe("research command", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv, FORCE_COLOR: "1" };
    vi.mocked(sdkSpawn).mockImplementation(() => ({
      events: emptyAsyncIterable(),
      result: Promise.resolve({ stdout: "", stderr: "", exitCode: 0 })
    }));
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.useRealTimers();
  });

  it("writes output with resume command and captures agent messages", async () => {
    vi.useFakeTimers();
    const now = new Date("2026-01-02T03:04:05Z");
    vi.setSystemTime(now);

    vi.mocked(sdkSpawn).mockImplementation(() => ({
      events: fromArray([
        { event: "agent_message", text: "Hello " },
        { event: "agent_message", text: "world" }
      ]),
      result: Promise.resolve({
        stdout: "",
        stderr: "",
        exitCode: 0,
        threadId: "thread_abc123"
      })
    }));

    const fs = createMemFs();
    const program = createProgram({
      fs,
      prompts: vi.fn().mockResolvedValue({ model: "openai/gpt-5.2" }),
      env: { cwd, homeDir },
      logger: () => {},
      suppressCommanderOutput: true
    });

    await program.parseAsync([
      "node",
      "cli",
      "research",
      "--agent",
      "codex",
      "Explain the project"
    ]);

    const outputPath = buildOutputPath(homeDir, "Explain the project", now);
    const content = await fs.readFile(outputPath, "utf8");

    expect(vi.mocked(sdkSpawn)).toHaveBeenCalledWith("codex", {
      prompt: expect.stringContaining("Explain the project"),
      args: [],
      model: "openai/gpt-5.2",
      mode: "read",
      cwd
    });

    expect(content).toContain("research_prompt: \"Explain the project\"");
    expect(content).toContain("agent: \"codex\"");
    expect(content).toContain("path: \"/repo\"");
    expect(content).toContain(
      "resume_session_cmd: \"codex resume -C /repo thread_abc123\""
    );
    expect(content).toContain("Hello world");
  });

  it("uses configured agent when --yes and no agent provided", async () => {
    const fs = createMemFs();
    const credentialsPath = path.join(homeDir, ".poe-code", "credentials.json");
    await fs.writeFile(
      credentialsPath,
      JSON.stringify({ configured_services: { codex: { files: [] } } }),
      { encoding: "utf8" }
    );

    const prompts = vi.fn().mockResolvedValue({});
    const program = createProgram({
      fs,
      prompts,
      env: { cwd, homeDir },
      logger: () => {},
      suppressCommanderOutput: true
    });

    await program.parseAsync([
      "node",
      "cli",
      "--yes",
      "research",
      "Explain the project"
    ]);

    expect(prompts.mock.calls.length).toBe(0);
    expect(vi.mocked(sdkSpawn)).toHaveBeenCalledWith("codex", expect.any(Object));
  });

  it("forwards model and agent args", async () => {
    const fs = createMemFs();
    const prompts = vi.fn().mockResolvedValue({});
    const program = createProgram({
      fs,
      prompts,
      env: { cwd, homeDir },
      logger: () => {},
      suppressCommanderOutput: true
    });

    await program.parseAsync([
      "node",
      "cli",
      "research",
      "--agent",
      "codex",
      "--model",
      "gpt-4",
      "Explain",
      "--",
      "--foo",
      "bar"
    ]);

    expect(vi.mocked(sdkSpawn)).toHaveBeenCalledWith("codex", {
      prompt: expect.stringContaining("Explain"),
      args: ["--foo", "bar"],
      model: "gpt-4",
      mode: "read",
      cwd
    });
  });

  it("reads prompt from stdin when --stdin is set", async () => {
    const fs = createMemFs();
    const prompts = vi.fn().mockResolvedValue({ model: "openai/gpt-5.2" });
    const program = createProgram({
      fs,
      prompts,
      env: { cwd, homeDir },
      logger: () => {},
      suppressCommanderOutput: true
    });

    const stdinStream = Readable.from([Buffer.from("Prompt via stdin")]);
    Object.defineProperty(stdinStream, "isTTY", { value: false });
    const stdinSpy = vi
      .spyOn(process, "stdin", "get")
      .mockReturnValue(stdinStream as NodeJS.ReadStream);

    try {
      await program.parseAsync([
        "node",
        "cli",
        "research",
        "--agent",
        "codex",
        "--stdin"
      ]);
    } finally {
      stdinSpy.mockRestore();
    }

    expect(vi.mocked(sdkSpawn)).toHaveBeenCalledWith("codex", {
      prompt: expect.stringContaining("Prompt via stdin"),
      args: [],
      model: "openai/gpt-5.2",
      mode: "read",
      cwd
    });
  });

  it("cleans up cloned repos unless --keep", async () => {
    const fs = createMemFs();
    const clonePath = buildClonePath(homeDir, "owner/repo");
    const { runner } = createCommandRunnerStub(async (command, args) => {
      if (command === "git" && args[0] === "clone") {
        const target = args[args.length - 1] ?? clonePath;
        await fs.mkdir(String(target), { recursive: true });
        return { stdout: "", stderr: "", exitCode: 0 };
      }
      return { stdout: "", stderr: "", exitCode: 0 };
    });

    const program = createProgram({
      fs,
      prompts: vi.fn().mockResolvedValue({ model: "openai/gpt-5.2" }),
      env: { cwd, homeDir },
      logger: () => {},
      commandRunner: runner,
      suppressCommanderOutput: true
    });

    await program.parseAsync([
      "node",
      "cli",
      "research",
      "--agent",
      "codex",
      "--github",
      "owner/repo",
      "Explain"
    ]);

    const exists = await pathExists(fs, clonePath);
    expect(exists).toBe(false);
  });

  it("preserves cloned repos with --keep", async () => {
    const fs = createMemFs();
    const clonePath = buildClonePath(homeDir, "owner/repo");
    const { runner } = createCommandRunnerStub(async (command, args) => {
      if (command === "git" && args[0] === "clone") {
        const target = args[args.length - 1] ?? clonePath;
        await fs.mkdir(String(target), { recursive: true });
        return { stdout: "", stderr: "", exitCode: 0 };
      }
      return { stdout: "", stderr: "", exitCode: 0 };
    });

    const program = createProgram({
      fs,
      prompts: vi.fn().mockResolvedValue({ model: "openai/gpt-5.2" }),
      env: { cwd, homeDir },
      logger: () => {},
      commandRunner: runner,
      suppressCommanderOutput: true
    });

    await program.parseAsync([
      "node",
      "cli",
      "research",
      "--agent",
      "codex",
      "--github",
      "owner/repo",
      "--keep",
      "Explain"
    ]);

    const exists = await pathExists(fs, clonePath);
    expect(exists).toBe(true);
  });

  it("cleans up cloned repos on spawn failure", async () => {
    vi.mocked(sdkSpawn).mockImplementation(() => ({
      events: emptyAsyncIterable(),
      result: Promise.resolve({ stdout: "", stderr: "", exitCode: 1 })
    }));

    const fs = createMemFs();
    const clonePath = buildClonePath(homeDir, "owner/repo");
    const { runner } = createCommandRunnerStub(async (command, args) => {
      if (command === "git" && args[0] === "clone") {
        const target = args[args.length - 1] ?? clonePath;
        await fs.mkdir(String(target), { recursive: true });
        return { stdout: "", stderr: "", exitCode: 0 };
      }
      return { stdout: "", stderr: "", exitCode: 0 };
    });

    const program = createProgram({
      fs,
      prompts: vi.fn().mockResolvedValue({ model: "openai/gpt-5.2" }),
      env: { cwd, homeDir },
      logger: () => {},
      commandRunner: runner,
      suppressCommanderOutput: true
    });

    await expect(
      program.parseAsync([
        "node",
        "cli",
        "research",
        "--agent",
        "codex",
        "--github",
        "owner/repo",
        "Explain"
      ])
    ).rejects.toThrow();

    const exists = await pathExists(fs, clonePath);
    expect(exists).toBe(false);
  });
});
