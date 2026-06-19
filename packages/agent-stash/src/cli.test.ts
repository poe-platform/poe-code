import { describe, expect, it } from "vitest";
import { Volume, createFsFromVolume } from "memfs";
import { gistFilenameForBundlePath } from "./bundle.js";
import { createAgentStashProgram, runCli } from "./cli.js";
import { createBackup } from "./backup-store.js";
import { hashFiles, sha256 } from "./hash.js";
import { parseManifest, serializeManifest } from "./manifest.js";
import { uploadBundle } from "./operations/upload.js";
import { InMemoryGistClient } from "./test-support/in-memory-gist-client.js";
import { createDummyAgentConfigFixture, dummyCwd, dummyHome, fixedDate } from "./test-support/dummy-config.js";
import type { AgentStashContext, AgentStashFileSystem } from "./types.js";
import type { AgentStashPromptAdapter } from "./cli.js";

function createHarness(
  files: Record<string, string> = createDummyAgentConfigFixture(),
  prompts?: AgentStashPromptAdapter
) {
  const volume = Volume.fromJSON(files, "/");
  const gistClient = new InMemoryGistClient();
  gistClient.seed({ id: "gist-default", htmlUrl: "https://gist.github.com/gist-default", files: {} });
  const output: string[] = [];
  const ctx: AgentStashContext = {
    cwd: dummyCwd,
    homeDir: dummyHome,
    fs: createFsFromVolume(volume).promises as unknown as AgentStashFileSystem,
    gistClient,
    now: () => fixedDate
  };
  const program = createAgentStashProgram({
    createContext() {
      return ctx;
    },
    writeOut(message) {
      output.push(message);
    },
    isInteractive: () => prompts !== undefined,
    prompts
  });
  program.exitOverride();
  return { program, volume, gistClient, output, ctx };
}

describe("agent-stash CLI", () => {
  it("prints an explicit empty profile list state", async () => {
    const files = createDummyAgentConfigFixture();
    delete files["/home/user/.agent-stash/config.json"];
    const { program, output } = createHarness(files);

    await program.parseAsync(["node", "agent-stash", "profile", "list"]);

    expect(output.join("")).toBe("No profiles configured.\n");
  });

  it("runs a fully flagged upload through the SDK with injected dependencies", async () => {
    const { program, gistClient, output } = createHarness();

    await program.parseAsync([
      "node",
      "agent-stash",
      "upload",
      "--profile",
      "default",
      "--scope",
      "project",
      "--agent",
      "claude-code",
      "--skills",
      "code-review",
      "--yes"
    ]);

    expect(output.join("")).toBe("Uploaded 1 item(s) to gist-default.\n");
    expect(gistClient.updateCalls).toHaveLength(1);
    expect(gistClient.updateCalls[0]?.input.files[gistFilenameForBundlePath("skills/project/claude-code/code-review/SKILL.md")]).toBeDefined();
  });

  it("uses project Claude defaults when --yes upload omits scope and agent", async () => {
    const { program, gistClient, output } = createHarness();

    await program.parseAsync([
      "node",
      "agent-stash",
      "upload",
      "--profile",
      "default",
      "--skills",
      "code-review",
      "--yes"
    ]);

    expect(output.join("")).toBe("Uploaded 1 item(s) to gist-default.\n");
    expect(gistClient.updateCalls).toHaveLength(1);
    expect(gistClient.updateCalls[0]?.input.files[gistFilenameForBundlePath("skills/project/claude-code/code-review/SKILL.md")]).toEqual({
      content: "# Code Review\n"
    });
  });

  it("rejects non-interactive upload without yes before writing a Gist", async () => {
    const { program, gistClient } = createHarness();

    await expect(program.parseAsync([
      "node",
      "agent-stash",
      "upload",
      "--profile",
      "default",
      "--scope",
      "project",
      "--agent",
      "claude-code",
      "--skills",
      "code-review"
    ])).rejects.toThrow("Upload writes require --yes in non-interactive mode.");
    expect(gistClient.updateCalls).toHaveLength(0);
    expect(gistClient.createCalls).toHaveLength(0);
    expect(gistClient.readCalls).toHaveLength(0);
  });

  it("rejects invalid scope flags before running an operation", async () => {
    const { program, gistClient } = createHarness();

    await expect(program.parseAsync([
      "node",
      "agent-stash",
      "upload",
      "--profile",
      "default",
      "--scope",
      "workspace",
      "--agent",
      "claude-code",
      "--skills",
      "code-review",
      "--yes"
    ])).rejects.toThrow('Invalid --scope "workspace". Expected project or global.');
    expect(gistClient.updateCalls).toHaveLength(0);
  });

  it("rejects invalid conflict policies before running sync", async () => {
    const { program, gistClient } = createHarness();

    await expect(program.parseAsync([
      "node",
      "agent-stash",
      "sync",
      "--profile",
      "default",
      "--scope",
      "project",
      "--agent",
      "claude-code",
      "--on-conflict",
      "merge",
      "--yes"
    ])).rejects.toThrow('Invalid --on-conflict "merge". Expected ask, local, remote, newer, or fail.');
    expect(gistClient.updateCalls).toHaveLength(0);
  });

  it("prints top-level CLI errors without stack traces", async () => {
    const { ctx, output } = createHarness();
    const errors: string[] = [];
    const previousExitCode = process.exitCode;
    process.exitCode = 0;
    try {
      await runCli([
        "node",
        "agent-stash",
        "upload",
        "--profile",
        "default",
        "--scope",
        "workspace",
        "--agent",
        "claude-code",
        "--skills",
        "code-review",
        "--yes"
      ], {
        createContext() {
          return ctx;
        },
        writeOut(message) {
          output.push(message);
        },
        writeErr(message) {
          errors.push(message);
        },
        isInteractive: () => false
      });
      expect(process.exitCode).toBe(1);
      expect(errors.join("")).toBe('Invalid --scope "workspace". Expected project or global.\n');
      expect(errors.join("")).not.toContain(" at ");
    } finally {
      process.exitCode = previousExitCode;
    }
  });

  it("prints backup list rows with target scope and agent", async () => {
    const { program, output, ctx } = createHarness({ "/repo/file.txt": "before" });
    await createBackup(ctx, {
      command: "download",
      args: { scope: "project", agent: "claude-code" },
      paths: ["/repo/file.txt"]
    });

    await program.parseAsync(["node", "agent-stash", "backup", "list"]);

    expect(output.join("")).toContain("backup-2026-01-02T03-04-05-000Z\t2026-01-02T03:04:05.000Z\tdownload\tproject\tclaude-code\n");
  });

  it("prints a browse snapshot from injected dependencies", async () => {
    const { program, output } = createHarness();

    await program.parseAsync([
      "node",
      "agent-stash",
      "browse",
      "--scope",
      "project",
      "--agent",
      "claude-code"
    ]);

    expect(output.join("")).toContain("Project: claude-code");
    expect(output.join("")).toContain("Global: claude-code");
    expect(output.join("")).toContain("code-review");
    expect(output.join("")).toContain("q quit");
  });

  it("prompts for upload profile, scope, agent, item selections, and confirmation when flags are missing", async () => {
    const prompts = createPromptHarness({
      select: ["default", "project", "claude-code"],
      multiselect: [["code-review"], ["PreToolUse"]],
      confirm: [true]
    });
    const { program, output, gistClient } = createHarness(createDummyAgentConfigFixture(), prompts);

    await program.parseAsync(["node", "agent-stash", "upload"]);

    expect(prompts.selectCalls.map((call) => call.message)).toEqual(["Profile", "Source", "Agent"]);
    expect(prompts.multiselectCalls.map((call) => call.message)).toEqual(["Skills", "Hooks"]);
    expect(prompts.confirmCalls[0]?.message).toBe('Upload 2 item(s) to profile "default"?');
    expect(gistClient.updateCalls).toHaveLength(1);
    expect(Object.keys(gistClient.updateCalls[0]?.input.files ?? {}).toSorted()).toEqual([
      "agent-stash.json",
      gistFilenameForBundlePath("hooks/project/claude-code/PreToolUse.json"),
      gistFilenameForBundlePath("skills/project/claude-code/code-review/SKILL.md")
    ]);
    expect(output.join("")).toBe("Uploaded 2 item(s) to gist-default.\n");
  });

  it("prompts for download destination and confirmation before enabling writes", async () => {
    const setup = createHarness();
    await setup.program.parseAsync([
      "node",
      "agent-stash",
      "upload",
      "--profile",
      "default",
      "--scope",
      "project",
      "--agent",
      "claude-code",
      "--skills",
      "code-review",
      "--yes"
    ]);
    const files = createDummyAgentConfigFixture();
    delete files["/repo/.claude/skills/code-review/SKILL.md"];
    const prompts = createPromptHarness({
      select: ["default", "project", "claude-code"],
      confirm: [true]
    });
    const target = createHarness(files, prompts);
    target.gistClient.seed(await setup.gistClient.read("gist-default"));

    await target.program.parseAsync(["node", "agent-stash", "download"]);

    expect(prompts.selectCalls.map((call) => call.message)).toEqual(["Profile", "Destination", "Agent"]);
    expect(prompts.confirmCalls[0]?.message).toBe('Download from profile "default" into project claude-code?');
    expect(target.volume.readFileSync("/repo/.claude/skills/code-review/SKILL.md", "utf8")).toBe("# Code Review\n");
    expect(target.output.join("")).toBe("Downloaded 1 item(s).\n");
  });

  it("downloads from an explicit --gist flag without a profile", async () => {
    const setup = createHarness();
    await setup.program.parseAsync([
      "node",
      "agent-stash",
      "upload",
      "--profile",
      "default",
      "--scope",
      "project",
      "--agent",
      "claude-code",
      "--skills",
      "code-review",
      "--yes"
    ]);
    const files = createDummyAgentConfigFixture();
    delete files["/repo/.claude/skills/code-review/SKILL.md"];
    delete files["/home/user/.agent-stash/config.json"];
    const target = createHarness(files);
    target.gistClient.seed(await setup.gistClient.read("gist-default"));

    await target.program.parseAsync([
      "node",
      "agent-stash",
      "download",
      "--gist",
      "gist-default",
      "--scope",
      "project",
      "--agent",
      "claude-code",
      "--yes"
    ]);

    expect(target.volume.readFileSync("/repo/.claude/skills/code-review/SKILL.md", "utf8")).toBe("# Code Review\n");
    expect(target.output.join("")).toBe("Downloaded 1 item(s).\n");
  });

  it("passes selected download skills through CLI flags", async () => {
    const setup = createHarness();
    await setup.program.parseAsync([
      "node",
      "agent-stash",
      "upload",
      "--profile",
      "default",
      "--scope",
      "project",
      "--agent",
      "claude-code",
      "--skills",
      "code-review,commit-helper",
      "--yes"
    ]);
    const files = createDummyAgentConfigFixture();
    delete files["/repo/.claude/skills/code-review/SKILL.md"];
    delete files["/repo/.claude/skills/commit-helper/SKILL.md"];
    const target = createHarness(files);
    target.gistClient.seed(await setup.gistClient.read("gist-default"));

    await target.program.parseAsync([
      "node",
      "agent-stash",
      "download",
      "--profile",
      "default",
      "--scope",
      "project",
      "--agent",
      "claude-code",
      "--skills",
      "code-review",
      "--yes"
    ]);

    expect(target.volume.readFileSync("/repo/.claude/skills/code-review/SKILL.md", "utf8")).toBe("# Code Review\n");
    expect(() => target.volume.statSync("/repo/.claude/skills/commit-helper/SKILL.md")).toThrow();
    expect(target.output.join("")).toBe("Downloaded 1 item(s).\n");
  });

  it("prompts per sync conflict when interactive conflict policy defaults to ask", async () => {
    const prompts = createPromptHarness({
      select: ["remote"],
      confirm: [true]
    });
    const harness = createHarness(createDummyAgentConfigFixture(), prompts);
    const upload = await uploadBundle(harness.ctx, {
      profile: "default",
      scope: "project",
      agent: "claude-code",
      skills: ["code-review"],
      yes: true
    });
    await harness.ctx.fs.mkdir("/home/user/.agent-stash/cache", { recursive: true });
    await harness.ctx.fs.writeFile(
      "/home/user/.agent-stash/cache/default.manifest.json",
      serializeManifest(upload.manifest),
      { encoding: "utf8" }
    );
    await harness.ctx.fs.writeFile(
      "/repo/.claude/skills/code-review/SKILL.md",
      "# Local Change\n",
      { encoding: "utf8" }
    );
    const record = await harness.gistClient.read("gist-default");
    const manifest = parseManifest(record.files["agent-stash.json"]!.content);
    const item = manifest.items.find((candidate) => candidate.name === "code-review")!;
    const remoteContent = "# Remote Change\n";
    item.files[0] = {
      ...item.files[0]!,
      size: Buffer.byteLength(remoteContent, "utf8"),
      sha256: sha256(remoteContent)
    };
    item.contentHash = hashFiles(item.files);
    record.files["agent-stash.json"] = {
      filename: "agent-stash.json",
      content: serializeManifest(manifest)
    };
    const remotePath = gistFilenameForBundlePath("skills/project/claude-code/code-review/SKILL.md");
    record.files[remotePath] = {
      filename: remotePath,
      content: remoteContent
    };
    harness.gistClient.seed(record);

    await harness.program.parseAsync([
      "node",
      "agent-stash",
      "sync",
      "--profile",
      "default",
      "--scope",
      "project",
      "--agent",
      "claude-code"
    ]);

    expect(prompts.confirmCalls[0]?.message).toBe('Sync profile "default" with project claude-code?');
    expect(prompts.selectCalls.map((call) => call.message)).toEqual(["Resolve conflict: code-review"]);
    expect(harness.volume.readFileSync("/repo/.claude/skills/code-review/SKILL.md", "utf8")).toBe(remoteContent);
    expect(harness.output.join("")).toBe("Uploaded 4, downloaded 1, conflicts 0.\n");
  });
});

function createPromptHarness(script: {
  select?: unknown[];
  multiselect?: unknown[][];
  confirm?: boolean[];
  text?: string[];
}): AgentStashPromptAdapter & {
  selectCalls: Array<{ message: string }>;
  multiselectCalls: Array<{ message: string }>;
  confirmCalls: Array<{ message: string }>;
  textCalls: Array<{ message: string }>;
} {
  const selectValues = [...(script.select ?? [])];
  const multiselectValues = [...(script.multiselect ?? [])];
  const confirmValues = [...(script.confirm ?? [])];
  const textValues = [...(script.text ?? [])];
  const selectCalls: Array<{ message: string }> = [];
  const multiselectCalls: Array<{ message: string }> = [];
  const confirmCalls: Array<{ message: string }> = [];
  const textCalls: Array<{ message: string }> = [];

  return {
    selectCalls,
    multiselectCalls,
    confirmCalls,
    textCalls,
    isCancel: () => false,
    async select(opts) {
      selectCalls.push({ message: opts.message });
      return selectValues.shift();
    },
    async multiselect(opts) {
      multiselectCalls.push({ message: opts.message });
      return multiselectValues.shift() ?? [];
    },
    async confirm(opts) {
      confirmCalls.push({ message: opts.message });
      return confirmValues.shift() ?? false;
    },
    async text(opts) {
      textCalls.push({ message: opts.message });
      return textValues.shift() ?? "";
    }
  };
}
